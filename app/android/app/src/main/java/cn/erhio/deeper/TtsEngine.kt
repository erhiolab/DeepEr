package cn.erhio.deeper

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.nio.FloatBuffer
import java.nio.LongBuffer
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.thread
import kotlin.concurrent.withLock

class TtsEngine(private val appContext: Context) {

    enum class State { UNAVAILABLE, COPYING, READY }

    companion object {
        private const val MODEL_DIR = "tts"
        private const val DATA_DIR = "tts_data"
        private const val EOS = 1024L
        private const val MAX_AR_STEPS = 600
        private const val BERT_DIM = 1024
        private const val OUT_SR = 32000
    }

    var state = State.UNAVAILABLE
        private set

    var initMessage = ""
        private set

    fun emotionNames(): List<String> = refs.keys.sorted()

    private val env: OrtEnvironment by lazy { OrtEnvironment.getEnvironment() }
    private var sessRoberta: OrtSession? = null
    private var sessEnc: OrtSession? = null
    private var sessFsd: OrtSession? = null
    private var sessSdc: OrtSession? = null
    private var sessVits: OrtSession? = null

    private var symbolToId: Map<String, Int> = emptyMap()
    private var charPhones: Map<String, List<String>> = emptyMap()
    private var vocab: Map<String, Int> = emptyMap()
    private var clsId = 0
    private var sepId = 0
    private var unkId = 0

    private val refs = HashMap<String, JSONObject>()
    private val refCache = HashMap<String, RefAudio>()
    private val refLock = Any()

    private class RefAudio(
        val audio32k: FloatArray,
        val ssl: FloatArray,
        val sslT: Int,
        val bert: FloatArray,
        val bertRows: Int,
        val seq: LongArray,
    )

    private val jobs = LinkedBlockingQueue<Job>()
    private val workerActive = AtomicBoolean(false)
    private val stopFlag = AtomicBoolean(false)
    private var track: AudioTrack? = null
    private val readyBuffers = HashMap<Int, FloatArray>()
    private val bufferLock = ReentrantLock()
    private var nextJobId = 1

    class Job(val id: Int, val text: String, val emotion: String)

    private fun modelsDir(): File = File(appContext.filesDir, MODEL_DIR)
    private fun dataDir(): File = File(appContext.filesDir, DATA_DIR)

    fun init(onDetail: (String) -> Unit) {
        state = State.COPYING
        runCatching {
            val fresh = extractAssets("tts", modelsDir(), onDetail)
            extractAssets("tts_data", dataDir(), onDetail)
            if (fresh) onDetail("TTS 模型解压完成")
            loadTables()
            state = State.READY
            initMessage = "TTS 引擎就绪"
            onDetail(initMessage)
        }.onFailure { e ->
            state = State.UNAVAILABLE
            initMessage = e.message ?: "TTS 数据缺失"
            onDetail(initMessage)
        }
    }

    private fun extractAssets(assetDir: String, target: File, onDetail: (String) -> Unit): Boolean {
        target.mkdirs()
        val code = versionCode()
        val stamp = File(target, ".ready")
        val names = appContext.assets.list(assetDir) ?: return false
        val want = names.filter { it != ".ready" }
        if (!stamp.exists() || stamp.readText().trim() != code.toString()) {
            want.forEachIndexed { i, name ->
                copyAsset("$assetDir/$name", File(target, name))
                onDetail("解压 ${i + 1}/${want.size}: $name")
            }
            stamp.writeText(code.toString())
            return true
        }
        want.forEach { if (!File(target, it).exists()) copyAsset("$assetDir/$it", File(target, it)) }
        return false
    }

    private fun copyAsset(path: String, out: File) {
        val tmp = File(out.absolutePath + ".part")
        appContext.assets.open(path).use { input ->
            tmp.outputStream().use { output -> input.copyTo(output, 256 * 1024) }
        }
        if (!tmp.renameTo(out)) {
            tmp.copyTo(out, overwrite = true)
            tmp.delete()
        }
    }

    private fun versionCode(): Int = runCatching {
        @Suppress("DEPRECATION")
        appContext.packageManager.getPackageInfo(appContext.packageName, 0).versionCode
    }.getOrElse { 0 }

    private fun loadTables() {
        val symbols = JSONArray(File(dataDir(), "symbols.json").readText())
        val sym = HashMap<String, Int>()
        for (i in 0 until symbols.length()) sym[symbols.getString(i)] = i
        symbolToId = sym

        val chars = HashMap<String, List<String>>()
        File(dataDir(), "pinyin.tsv").readLines().forEach { line ->
            val i = line.indexOf('\t')
            if (i > 0) chars[line.substring(0, i)] = line.substring(i + 1).split(' ').filter { it.isNotEmpty() }
        }
        charPhones = chars

        val vocabObj = JSONObject(File(dataDir(), "roberta_vocab.json").readText())
        val m = HashMap<String, Int>()
        vocabObj.keys().forEach { k -> m[k] = vocabObj.getInt(k) }
        vocab = m
        clsId = vocab["[CLS]"] ?: 101
        sepId = vocab["[SEP]"] ?: 102
        unkId = vocab["[UNK]"] ?: 100

        val arr = JSONArray(File(dataDir(), "refs.json").readText())
        for (i in 0 until arr.length()) {
            val r = arr.getJSONObject(i)
            refs[r.getString("name")] = r
        }
    }

    private fun session(file: String): OrtSession {
        val so = OrtSession.SessionOptions()
        val fp = android.os.Build.FINGERPRINT.lowercase()
        val onEmulator = fp.contains("generic") || fp.contains("sdk_gphone") || fp.contains("emulator")
        so.setIntraOpNumThreads(if (onEmulator) 1 else 2)
        runCatching { so.addConfigEntry("session.intra_op.allow_spinning", "0") }
        android.util.Log.d("TtsEngine", "creating session $file threads=${if (onEmulator) 1 else 2}")
        val t = android.os.SystemClock.elapsedRealtime()
        val s = env.createSession(File(modelsDir(), file).absolutePath, so)
        so.close()
        android.util.Log.d("TtsEngine", "session $file ready in ${android.os.SystemClock.elapsedRealtime() - t}ms outputs=${s.outputNames}")
        return s
    }

    private fun ensureSessions() {
        if (sessVits != null) return
        sessRoberta = session("nori_roberta_int8.onnx")
        sessEnc = session("nori_t2s_encoder_fp32.onnx")
        val fsd = listOf("nori_t2s_fsdec_fp32.onnx", "nori_t2s_fsdec_int8.onnx")
            .firstOrNull { File(modelsDir(), it).exists() }
            ?: throw IllegalStateException("fsdec 模型缺失")
        val sdc = listOf("nori_t2s_sdec_fp32.onnx", "nori_t2s_sdec_int8.onnx")
            .firstOrNull { File(modelsDir(), it).exists() }
            ?: throw IllegalStateException("sdec 模型缺失")
        sessFsd = session(fsd)
        sessSdc = session(sdc)
        sessVits = session("nori_vits_fp32.onnx")
    }


    private fun phoneTone(phones: List<String>): Int {
        for (p in phones.reversed()) {
            val c = p.last()
            if (c in '1'..'5') return c - '0'
        }
        return 0
    }

    private fun retone(phones: List<String>, tone: Int): List<String> {
        val out = phones.toMutableList()
        for (i in out.indices.reversed()) {
            val p = out[i]
            if (p.isNotEmpty() && p.last() in '1'..'5') {
                out[i] = p.dropLast(1) + tone
                return out
            }
        }
        return out
    }

    private val punctMap = mapOf(
        '，' to ",", '。' to ".", '！' to "!", '？' to "?", '；' to ",", '：' to ",",
        '、' to ",", '…' to "…", '～' to "-", '·' to ",", '—' to "-", '－' to "-",
        '“' to "'", '”' to "'", '‘' to "'", '’' to "'",
    )

    fun phonesFor(text: String): Pair<List<Int>, IntArray> {
        val cleaned = text.filterNot { it.isWhitespace() }
        val phones = ArrayList<String>()
        val word2ph = IntArray(cleaned.length)
        for (i in cleaned.indices) {
            val ch = cleaned[i]
            var ph: List<String>? = charPhones[ch.toString()]
            if (ph == null) {
                val p = punctMap[ch]
                if (p != null) ph = listOf(p)
            }
            if (ph == null && symbolToId.containsKey(ch.toString())) ph = listOf(ch.toString())
            val base = ph
            if (base != null) {
                var cur = base
                if (ch == '不' && i + 1 < cleaned.length) {
                    val next = charPhones[cleaned[i + 1].toString()]
                    if (next != null && phoneTone(next) == 4) cur = retone(cur, 2)
                }
                if (ch == '一' && i + 1 < cleaned.length) {
                    val prevIsNum = i > 0 && (cleaned[i - 1] == '一' || cleaned[i - 1] in '0'..'9')
                    if (!prevIsNum) {
                        val t = charPhones[cleaned[i + 1].toString()]?.let { phoneTone(it) } ?: 0
                        cur = when (t) {
                            4 -> retone(cur, 2)
                            in 1..3 -> retone(cur, 4)
                            else -> cur
                        }
                    }
                }
                phones.addAll(cur)
                word2ph[i] = cur.size
            }
        }
        val ids = ArrayList<Int>(phones.size)
        for (p in phones) symbolToId[p]?.let { ids.add(it) }
        return Pair(ids, word2ph)
    }


    private fun tokenizePerChar(cleaned: String): LongArray {
        val ids = LongArray(cleaned.length + 2)
        ids[0] = clsId.toLong()
        for (i in cleaned.indices) {
            ids[i + 1] = (vocab[cleaned[i].lowercaseChar().toString()] ?: unkId).toLong()
        }
        ids[cleaned.length + 1] = sepId.toLong()
        return ids
    }

    private fun textBert(text: String, word2ph: IntArray): FloatArray {
        val cleaned = text.filterNot { it.isWhitespace() }
        val ids = tokenizePerChar(cleaned)
        val t = OnnxTensor.createTensor(env, LongBuffer.wrap(ids), longArrayOf(1, ids.size.toLong()))
        val out = sessRoberta!!.run(mapOf("input_ids" to t), setOf("feat"))
        t.close()
        val feat = (out.get(0) as OnnxTensor).value as Array<Array<FloatArray>>
        out.close()
        val rows = word2ph.sum()
        val flat = FloatArray(rows * BERT_DIM)
        var p = 0
        for (i in cleaned.indices) {
            val row = feat[0].getOrNull(i + 1) ?: continue
            repeat(word2ph[i]) {
                System.arraycopy(row, 0, flat, p * BERT_DIM, BERT_DIM); p++
            }
        }
        return flat
    }


    private fun refAudio(emotion: String): RefAudio {
        synchronized(refLock) {
            refCache[emotion]?.let { return it }
            val r = refs[emotion] ?: refs["gentleness"] ?: refs.values.first()
            val wav = decodeWav(appContext.assets.open("ref/" + r.getString("audio")))
            val a32 = resample(wav.first, wav.second, OUT_SR)
            val sslT = r.getInt("refSslT")
            val bertRows = r.getInt("refBertRows")
            val seq = r.getJSONArray("refSeq").let { ja -> LongArray(ja.length()) { ja.getLong(it) } }
            val ra = RefAudio(
                a32, FloatArray(768 * sslT), sslT,
                FloatArray(bertRows * BERT_DIM), bertRows, seq
            )
            File(dataDir(), r.getString("refSslFile")).let { readFloatLE(it, ra.ssl) }
            File(dataDir(), r.getString("refBertFile")).let { readFloatLE(it, ra.bert) }
            refCache[emotion] = ra
            return ra
        }
    }

    private fun decodeWav(input: java.io.InputStream): Pair<FloatArray, Int> {
        val bytes = input.use { it.readBytes() }
        var pos = 12
        var sampleRate = 16000
        var channels = 1
        var dataStart = -1
        var dataLen = 0
        while (pos + 8 <= bytes.size) {
            val id = String(bytes, pos, 4, Charsets.US_ASCII)
            val size = leInt(bytes, pos + 4)
            if (id == "fmt ") {
                channels = leShort(bytes, pos + 10)
                sampleRate = leInt(bytes, pos + 12)
            } else if (id == "data") {
                dataStart = pos + 8
                dataLen = size
                break
            }
            pos += 8 + size + (size and 1)
        }
        require(dataStart > 0) { "wav data chunk missing" }
        val samples = dataLen / 2
        val out = FloatArray(samples)
        var p = dataStart
        for (i in 0 until samples) {
            out[i] = leShort(bytes, p).toShort().toInt() / 32768f
            p += 2
        }
        val mono = if (channels > 1) FloatArray(samples / channels) { i -> out[i * channels] } else out
        return Pair(mono, sampleRate)
    }

    private fun leInt(b: ByteArray, off: Int): Int =
        (b[off].toInt() and 0xFF) or ((b[off + 1].toInt() and 0xFF) shl 8) or
            ((b[off + 2].toInt() and 0xFF) shl 16) or ((b[off + 3].toInt() and 0xFF) shl 24)

    private fun leShort(b: ByteArray, off: Int): Int =
        (b[off].toInt() and 0xFF) or ((b[off + 1].toInt() and 0xFF) shl 8)

    private fun readFloatLE(f: File, into: FloatArray) {
        val bytes = f.readBytes()
        val fb = java.nio.ByteBuffer.wrap(bytes).order(java.nio.ByteOrder.LITTLE_ENDIAN).asFloatBuffer()
        require(fb.remaining() >= into.size) { "特征文件不完整: ${f.name}" }
        fb.get(into)
    }

    private fun resample(input: FloatArray, from: Int, to: Int): FloatArray {
        if (from == to) return input
        val n = (input.size.toLong() * to / from).toInt()
        val out = FloatArray(n)
        val step = from.toDouble() / to
        var src = 0.0
        for (i in 0 until n) {
            val i0 = src.toInt()
            val frac = (src - i0).toFloat()
            val a = input.getOrElse(i0) { 0f }
            val b = input.getOrElse(i0 + 1) { a }
            out[i] = a + (b - a) * frac
            src += step
        }
        return out
    }


    private fun fTensor(arr: FloatArray, shape: LongArray): OnnxTensor =
        OnnxTensor.createTensor(env, FloatBuffer.wrap(arr), shape)

    private fun lTensor(arr: LongArray, shape: LongArray): OnnxTensor =
        OnnxTensor.createTensor(env, LongBuffer.wrap(arr), shape)

    private class TData(val flat: FloatArray, val dims: LongArray)

    private fun tData(t: OnnxTensor): TData = TData(floatsOf(t), t.info.shape)

    private fun floatsOf(t: OnnxTensor): FloatArray = when (t.info.shape.size) {
        1 -> t.value as FloatArray
        2 -> flat2(t.value as Array<FloatArray>)
        3 -> flat3(t.value as Array<Array<FloatArray>>)
        4 -> flat4(t.value as Array<Array<Array<FloatArray>>>)
        else -> throw IllegalStateException("unsupported rank ${t.info.shape.size}")
    }

    private fun longsOf(t: OnnxTensor): LongArray {
        val total = t.info.shape.fold(1L) { acc, d -> acc * d }.toInt()
        return when (val v = t.value) {
            is LongArray -> v
            is IntArray -> LongArray(v.size) { v[it].toLong() }
            is Array<*> -> {
                val r = LongArray(total); var p = 0
                for (row in v) {
                    when (row) {
                        is LongArray -> { System.arraycopy(row, 0, r, p, row.size); p += row.size }
                        is IntArray -> { for (x in row) { r[p] = x.toLong(); p++ } }
                        else -> throw IllegalStateException("unsupported long row")
                    }
                }
                r
            }
            else -> throw IllegalStateException("unsupported long tensor")
        }
    }

    private fun flat3(a: Array<Array<FloatArray>>): FloatArray {
        val d2 = if (a.isEmpty() || a[0].isEmpty()) 0 else a[0][0].size
        val out = FloatArray(a.sumOf { m -> m.size * d2 })
        var p = 0
        for (m in a) for (row in m) { System.arraycopy(row, 0, out, p, d2); p += d2 }
        return out
    }

    private fun flat2(a: Array<FloatArray>): FloatArray {
        val rows = a.sumOf { it.size }
        val out = FloatArray(rows)
        var p = 0
        for (row in a) { System.arraycopy(row, 0, out, p, row.size); p += row.size }
        return out
    }

    private fun flat4(a: Array<Array<Array<FloatArray>>>): FloatArray {
        val d3 = if (a.isEmpty() || a[0].isEmpty() || a[0][0].isEmpty()) 0 else a[0][0][0].size
        val total = a.sumOf { m -> m.sumOf { mid -> mid.size * d3 } }
        val out = FloatArray(total)
        var p = 0
        for (m in a) for (mid in m) for (row in mid) { System.arraycopy(row, 0, out, p, d3); p += d3 }
        return out
    }

    fun synthesize(text: String, emotion: String): FloatArray {
        ensureSessions()
        val t0 = android.os.SystemClock.elapsedRealtime()
        val (ids, word2ph) = phonesFor(text)
        require(ids.isNotEmpty()) { "文本没有可合成的音素" }
        val textSeq = ids.map { it.toLong() }.toLongArray()
        val bertFlat = textBert(text, word2ph)
        val bertRows = bertFlat.size / BERT_DIM
        require(bertRows == textSeq.size) { "音素与BERT对齐失败: ${bertRows} vs ${textSeq.size}" }
        val ref = refAudio(emotion)

        val tRefSeq = lTensor(ref.seq, longArrayOf(1, ref.seq.size.toLong()))
        val tTextSeq = lTensor(textSeq, longArrayOf(1, textSeq.size.toLong()))
        val tRefBert = fTensor(ref.bert, longArrayOf(ref.bertRows.toLong(), BERT_DIM.toLong()))
        val tTextBert = fTensor(bertFlat, longArrayOf(bertRows.toLong(), BERT_DIM.toLong()))
        val tSsl = fTensor(ref.ssl, longArrayOf(1, 768, ref.sslT.toLong()))

        val tAudioRef = fTensor(ref.audio32k, longArrayOf(1, ref.audio32k.size.toLong()))

        try {
            val encOut = sessEnc!!.run(mapOf(
                "ref_seq" to tRefSeq, "text_seq" to tTextSeq,
                "ref_bert" to tRefBert, "text_bert" to tTextBert, "ssl_content" to tSsl),
                setOf("x", "prompts"))
            val xd = tData(encOut.get(0) as OnnxTensor)
            val prArr = longsOf(encOut.get(1) as OnnxTensor)
            encOut.close()

            val tX = fTensor(xd.flat, xd.dims)
            val tPrompts = lTensor(prArr, longArrayOf(1, prArr.size.toLong()))

            val fsdOut = sessFsd!!.run(mapOf("x" to tX, "prompts" to tPrompts),
                setOf("out_0", "out_1", "out_2", "out_3", "out_4"))
            val yArr = longsOf(fsdOut.get(0) as OnnxTensor)
            val kD = tData(fsdOut.get(1) as OnnxTensor)
            val vD = tData(fsdOut.get(2) as OnnxTensor)
            val yEmbD = tData(fsdOut.get(3) as OnnxTensor)
            val xExD = tData(fsdOut.get(4) as OnnxTensor)
            fsdOut.close()
            runCatching { tX.close(); tPrompts.close() }

            var tY = lTensor(yArr, longArrayOf(1, yArr.size.toLong()))
            var tK = fTensor(kD.flat, kD.dims)
            var tV = fTensor(vD.flat, vD.dims)
            var tYEmb = fTensor(yEmbD.flat, yEmbD.dims)
            val tXEx = fTensor(xExD.flat, xExD.dims)

            var steps = 0
            var done = false
            while (steps < MAX_AR_STEPS && !done) {
                if (steps % 50 == 0) android.util.Log.d("TtsEngine", "ar step=$steps/${MAX_AR_STEPS}")
                val out = sessSdc!!.run(mapOf(
                    "iy" to tY, "ik" to tK, "iv" to tV, "iy_emb" to tYEmb, "ix_example" to tXEx),
                    setOf("out_0", "out_1", "out_2", "out_3", "out_4", "out_5"))
                val nyArr = longsOf(out.get(0) as OnnxTensor)
                val nKD = tData(out.get(1) as OnnxTensor)
                val nVD = tData(out.get(2) as OnnxTensor)
                val nyEmbD = tData(out.get(3) as OnnxTensor)
                val logits = floatsOf(out.get(4) as OnnxTensor)
                val samples = longsOf(out.get(5) as OnnxTensor)
                out.close()
                tY.close(); tK.close(); tV.close(); tYEmb.close()
                tY = lTensor(nyArr, longArrayOf(1, nyArr.size.toLong()))
                tK = fTensor(nKD.flat, nKD.dims)
                tV = fTensor(nVD.flat, nVD.dims)
                tYEmb = fTensor(nyEmbD.flat, nyEmbD.dims)
                steps++
                val row = logits
                var argmax = 0
                for (i in row.indices) if (row[i] > row[argmax]) argmax = i
                if (samples[0] == EOS || argmax.toLong() == EOS) done = true
            }

            val yTokens = (tY.value as Array<LongArray>)[0].copyOf()
            if (yTokens.isNotEmpty()) yTokens[yTokens.size - 1] = 0L
            val tPred = lTensor(yTokens, longArrayOf(1, 1, yTokens.size.toLong()))
            val vitsOut = sessVits!!.run(mapOf(
                "text_seq" to tTextSeq, "pred_semantic" to tPred,
                "ref_audio" to tAudioRef),
                setOf("audio"))
            val audio = floatsOf(vitsOut.get(0) as OnnxTensor)
            vitsOut.close()
            runCatching { tPred.close() }
            android.util.Log.d("TtsEngine", "synth done: steps=$steps audioSec=${audio.size / 32000.0} costMs=${android.os.SystemClock.elapsedRealtime() - t0} eosHit=$done")
            return audio
        } finally {
            runCatching { tRefSeq.close(); tTextSeq.close(); tRefBert.close(); tTextBert.close(); tSsl.close(); tAudioRef.close() }
        }
    }


    fun enqueue(text: String, emotion: String): Int {
        val job = Job(nextJobId++, text, emotion)
        jobs.put(job)
        startWorker()
        return job.id
    }

    private fun startWorker() {
        if (!workerActive.compareAndSet(false, true)) return
        thread(name = "tts-synth") {
            android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_BACKGROUND)
            while (true) {
                val job = jobs.poll() ?: break
                if (stopFlag.get()) continue
                try {
                    val pcm = synthesize(job.text, job.emotion)
                    val ev = if (stopFlag.get()) continue else {
                        bufferLock.withLock { readyBuffers[job.id] = pcm }
                        """{"event":"ready","id":${job.id}}"""
                    }
                    onEvent?.invoke(ev)
                } catch (e: Exception) {
                    android.util.Log.e("TtsEngine", "synth failed id=${job.id}", e)
                    onEvent?.invoke("""{"event":"error","id":${job.id},"message":${JSONObject.quote(e.message ?: "合成失败")}}""")
                }
            }
            workerActive.set(false)
        }
    }

    var onEvent: ((String) -> Unit)? = null

    fun playBuffered(id: Int) {
        thread(name = "tts-play") {
            android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_BACKGROUND)
            val pcm = bufferLock.withLock { readyBuffers.remove(id) }
            if (pcm == null) {
                onEvent?.invoke("""{"event":"error","id":$id,"message":"无音频"}""")
                return@thread
            }
            if (stopFlag.get()) return@thread
            playPcm(pcm)
            onEvent?.invoke("""{"event":"done","id":$id}""")
        }
    }

    private fun playPcm(pcm: FloatArray) {
        val buf = ShortArray(pcm.size)
        for (i in pcm.indices) buf[i] = (pcm[i].coerceIn(-1f, 1f) * 32767f).toInt().toShort()
        val t = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build())
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(OUT_SR)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build())
            .setTransferMode(AudioTrack.MODE_STATIC)
            .setBufferSizeInBytes(buf.size * 2)
            .build()
        track = t
        t.write(buf, 0, buf.size)
        t.play()
        val total = buf.size.toLong() * 1000 / OUT_SR + 150
        Thread.sleep(total)
        runCatching { t.stop(); t.release() }
        if (track === t) track = null
    }

    fun stopAll() {
        stopFlag.set(true)
        jobs.clear()
        bufferLock.withLock { readyBuffers.clear() }
        runCatching { track?.pause(); track?.flush() }
        runCatching { track?.stop(); track?.release() }
        track = null
        stopFlag.set(false)
    }
}
