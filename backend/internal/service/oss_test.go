package service

import (
	"errors"
	"testing"
)

func TestResourceObjectKeyAcceptsSafeSegments(t *testing.T) {
	key, err := resourceObjectKey("live2d", "arg-nori_01")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if key != "live2d/arg-nori_01.zip" {
		t.Fatalf("unexpected key: %q", key)
	}
}

func TestObjectKeysRejectTraversalAndEncodedSeparators(t *testing.T) {
	tests := []struct {
		name       string
		objectType string
		objectName string
	}{
		{name: "parent segment", objectType: "live2d", objectName: "../secret"},
		{name: "forward slash", objectType: "live2d/other", objectName: "model"},
		{name: "backslash", objectType: "live2d", objectName: `..\secret`},
		{name: "double encoded traversal", objectType: "live2d", objectName: "%2e%2e%2fsecret"},
		{name: "control character", objectType: "live2d", objectName: "model\nsecret"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := resourceObjectKey(test.objectType, test.objectName)
			if !errors.Is(err, ErrInvalidObjectKey) {
				t.Fatalf("expected ErrInvalidObjectKey, got %v", err)
			}
		})
	}
}

func TestCoverObjectKeyRejectsTraversal(t *testing.T) {
	for _, modelID := range []string{"../private", `folder\model`, "%2fprivate", ".", " model"} {
		if _, err := coverObjectKey(modelID); !errors.Is(err, ErrInvalidObjectKey) {
			t.Fatalf("expected %q to be rejected, got %v", modelID, err)
		}
	}
}
