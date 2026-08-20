set CGO_ENABLED=0

set GOOS=windows
set GOARCH=amd64
go build -o deeper-api-windows.exe ./cmd/server

set GOOS=linux
set GOARCH=amd64
go build -o deeper-api-linux ./cmd/server