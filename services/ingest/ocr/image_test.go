package ocr

import (
	"context"
	"encoding/binary"
	"testing"
)

func TestHugePNGNeverReachesTesseract(t *testing.T) {
	png := make([]byte, 24)
	copy(png, []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'})
	binary.BigEndian.PutUint32(png[8:12], 13)
	copy(png[12:16], []byte("IHDR"))
	binary.BigEndian.PutUint32(png[16:20], 10000)
	binary.BigEndian.PutUint32(png[20:24], 10000)
	err := imageWithinCaps(png)
	if err != ErrImageLimits {
		t.Fatalf("err %v", err)
	}
	_, err = (Tesseract{}).Recognize(context.Background(), png, "eng")
	if err != ErrImageLimits {
		t.Fatalf("recognize err %v, want image_limits before tesseract", err)
	}
}

func TestTinyPNGHeaderIsMeasured(t *testing.T) {
	png := make([]byte, 24)
	copy(png, []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'})
	binary.BigEndian.PutUint32(png[8:12], 13)
	copy(png[12:16], []byte("IHDR"))
	binary.BigEndian.PutUint32(png[16:20], 32)
	binary.BigEndian.PutUint32(png[20:24], 32)
	if err := imageWithinCaps(png); err != nil {
		t.Fatal(err)
	}
}
