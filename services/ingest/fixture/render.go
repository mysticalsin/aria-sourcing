// Package fixture builds synthetic CV images for the OCR tests.
// Names, inboxes and employers in the callers' lines are invented.
package fixture

import (
	"bytes"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"os"

	"golang.org/x/image/font"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/math/fixed"
)

// RenderPNG draws lines in a sans face large enough for Tesseract.
// fontPath is a TTF on disk (DejaVu Sans in CI). The image is white,
// the glyphs are black, and the width follows the longest line so a
// line cannot be clipped.
func RenderPNG(lines []string, fontPath string) ([]byte, error) {
	raw, err := os.ReadFile(fontPath)
	if err != nil {
		return nil, err
	}
	face, err := opentype.Parse(raw)
	if err != nil {
		return nil, err
	}
	fnt, err := opentype.NewFace(face, &opentype.FaceOptions{
		Size:    42,
		DPI:     150,
		Hinting: font.HintingFull,
	})
	if err != nil {
		return nil, err
	}
	if c, ok := fnt.(interface{ Close() error }); ok {
		defer c.Close()
	}

	drawer := &font.Drawer{Face: fnt}
	width := 900
	for _, line := range lines {
		w := drawer.MeasureString(line).Round()
		if w+160 > width {
			width = w + 160
		}
	}
	gap := 90
	height := 140 + gap*len(lines)
	img := image.NewGray(image.Rect(0, 0, width, height))
	draw.Draw(img, img.Bounds(), image.NewUniform(color.White), image.Point{}, draw.Src)
	drawer.Dst = img
	drawer.Src = image.Black
	y := 110
	for _, line := range lines {
		drawer.Dot = fixed.P(70, y)
		drawer.DrawString(line)
		y += gap
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
