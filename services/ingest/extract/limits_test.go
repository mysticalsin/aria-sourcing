package extract

import (
	"bytes"
	"context"
	"fmt"
	"testing"
)

func TestPageTooLargeBeforeRaster(t *testing.T) {
	small := []byte("%PDF-1.4\n1 0 obj\n<< /MediaBox [0 0 612 792] >>\nendobj\n")
	if PageTooLarge(small) {
		t.Fatal("letter page flagged")
	}
	huge := []byte("%PDF-1.4\n1 0 obj\n<< /MediaBox [0 0 50000 50000] >>\nendobj\n")
	if !PageTooLarge(huge) {
		t.Fatal("huge page box accepted")
	}
	_, err := RasterPDF(context.Background(), huge)
	if err != ErrPageTooLarge {
		t.Fatalf("raster err %v", err)
	}
}

func TestRasterArgsCapDPIAndSide(t *testing.T) {
	args := pdftoppmArgs("/tmp/in.pdf", "/tmp/page")
	joined := " " + join(args) + " "
	if !bytes.Contains([]byte(joined), []byte(" -r 150 ")) {
		t.Fatalf("dpi not pinned: %v", args)
	}
	wantSide := fmt.Sprintf(" -scale-to %d ", MaxRasterSide)
	if !bytes.Contains([]byte(joined), []byte(wantSide)) {
		t.Fatalf("pixel side not capped: %v", args)
	}
	if RasterDPI != 150 || MaxRasterSide > 2200 || MaxRasterPixels > 2200*2200 {
		t.Fatalf("caps dpi %d side %d", RasterDPI, MaxRasterSide)
	}
}

func join(args []string) string {
	out := ""
	for i, a := range args {
		if i > 0 {
			out += " "
		}
		out += a
	}
	return out
}
