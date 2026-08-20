package service

import (
	"backend/internal/config"
	"backend/internal/logger"
	"fmt"
	"io"
	"strconv"

	"github.com/aliyun/aliyun-oss-go-sdk/oss"
	"go.uber.org/zap"
)

// OSSService OSS服务
type OSSService struct {
	client *oss.Client
	bucket *oss.Bucket
	cfg    config.OSSConfig
}

// NewOSSService 创建OSS服务实例
func NewOSSService() (*OSSService, error) {
	cfg := config.Get().OSS

	client, err := oss.New(cfg.Endpoint, cfg.AccessKeyID, cfg.AccessKeySecret)
	if err != nil {
		logger.Log.Error("创建OSS客户端失败", zap.Error(err))
		return nil, fmt.Errorf("创建OSS客户端失败: %w", err)
	}

	bucket, err := client.Bucket(cfg.BucketName)
	if err != nil {
		logger.Log.Error("获取OSS Bucket失败", zap.Error(err))
		return nil, fmt.Errorf("获取OSS Bucket失败: %w", err)
	}

	return &OSSService{
		client: client,
		bucket: bucket,
		cfg:    cfg,
	}, nil
}

// GetSignedURL 获取对象签名URL
// objectType: 资源类型 (live2d, voice等)
// objectName: 资源名称
func (s *OSSService) GetSignedURL(objectType, objectName string) (string, error) {
	// 构建对象路径: live2d/nori.zip
	objectKey := fmt.Sprintf("%s/%s.zip", objectType, objectName)

	// 检查对象是否存在
	exists, err := s.bucket.IsObjectExist(objectKey)
	if err != nil {
		logger.Log.Error("检查对象是否存在失败", zap.String("objectKey", objectKey), zap.Error(err))
		return "", fmt.Errorf("检查对象是否存在失败: %w", err)
	}
	if !exists {
		logger.Log.Warn("对象不存在", zap.String("objectKey", objectKey))
		return "", fmt.Errorf("资源不存在: %s", objectKey)
	}

	// 生成签名URL
	signedURL, err := s.bucket.SignURL(objectKey, oss.HTTPGet, int64(s.cfg.URLExpireSeconds))
	if err != nil {
		logger.Log.Error("生成签名URL失败", zap.String("objectKey", objectKey), zap.Error(err))
		return "", fmt.Errorf("生成签名URL失败: %w", err)
	}

	logger.Log.Info("生成签名URL成功", zap.String("objectKey", objectKey))
	return signedURL, nil
}

// 封面图 OSS 前缀目录 (私有读, 由后端代理并设置浏览器缓存)
const coverDir = "live2d-images"

// defaultCoverCacheSeconds 未配置 cover-cache-seconds 时的默认缓存秒数 (7 天)
const defaultCoverCacheSeconds int64 = 7 * 24 * 60 * 60

// CoverMeta 封面对象的元信息
type CoverMeta struct {
	// 内容类型, 一般为 image/webp
	ContentType string
	// Content-Length (字节)
	Size int64
	// 响应缓存时间 (秒)
	CacheSeconds int64
	// ETag, 用于 If-None-Match 条件请求以命中浏览器缓存
	ETag string
	// 对象最后修改时间 (HTTP Date 格式), 用于 If-Modified-Since
	LastModified string
}

// OpenCover 打开模型封面对象 live2d-images/<modelID>.webp
// 返回可读流与对象元信息; 调用方需负责关闭返回的流.
func (s *OSSService) OpenCover(modelID string) (io.ReadCloser, *CoverMeta, error) {
	objectKey := fmt.Sprintf("%s/%s.webp", coverDir, modelID)

	// 检查对象是否存在 (与 GetSignedURL 保持一致)
	exists, err := s.bucket.IsObjectExist(objectKey)
	if err != nil {
		logger.Log.Error("检查封面是否存在失败", zap.String("objectKey", objectKey), zap.Error(err))
		return nil, nil, fmt.Errorf("检查封面是否存在失败: %w", err)
	}
	if !exists {
		logger.Log.Warn("封面不存在", zap.String("objectKey", objectKey))
		return nil, nil, fmt.Errorf("封面不存在: %s", objectKey)
	}

	meta, err := s.bucket.GetObjectMeta(objectKey)
	if err != nil {
		logger.Log.Error("读取封面元信息失败", zap.String("objectKey", objectKey), zap.Error(err))
		return nil, nil, fmt.Errorf("读取封面元信息失败: %w", err)
	}

	body, err := s.bucket.GetObject(objectKey)
	if err != nil {
		logger.Log.Error("读取封面失败", zap.String("objectKey", objectKey), zap.Error(err))
		return nil, nil, fmt.Errorf("读取封面失败: %w", err)
	}

	cacheSeconds := int64(s.cfg.CoverCacheSeconds)
	if cacheSeconds <= 0 {
		cacheSeconds = defaultCoverCacheSeconds
	}

	size, _ := strconv.ParseInt(meta.Get("Content-Length"), 10, 64)

	return body, &CoverMeta{
		ContentType:  meta.Get("Content-Type"),
		Size:         size,
		CacheSeconds: cacheSeconds,
		ETag:         meta.Get("ETag"),
		LastModified: meta.Get("Last-Modified"),
	}, nil
}
