package extract

import (
	"bytes"
	"strconv"
	"unicode"
)

// Raster and page caps applied before pdftoppm runs. DPI is ours, not the
// PDF's: a file cannot ask for a higher resolution. The longest side of a
// rendered page is MaxRasterSide pixels, so the pixel count stays at or
// under MaxRasterSide squared. A MediaBox edge longer than MaxPagePoints
// (20 inches) is refused before Poppler is started.
const (
	RasterDPI        = 150
	MaxRasterSide    = 2200
	MaxPagePoints    = 1440
	MaxRenderedBytes = 8 << 20
)

// MaxRasterPixels is the pixel budget for one page or one uploaded image.
const MaxRasterPixels = MaxRasterSide * MaxRasterSide

// ErrPageTooLarge means the PDF page box or a rendered image exceeds the cap.
// The error string is a code, not a piece of the file.
var ErrPageTooLarge = errPageTooLarge{}

type errPageTooLarge struct{}

func (errPageTooLarge) Error() string { return "page_too_large" }

// PageTooLarge reports whether any page box is larger than MaxPagePoints
// on either edge. A file with no page box is not large; the raster step
// still scales into MaxRasterSide.
func PageTooLarge(pdf []byte) bool {
	for _, key := range [][]byte{[]byte("/MediaBox"), []byte("/CropBox"), []byte("/BleedBox")} {
		rest := pdf
		for {
			i := bytes.Index(rest, key)
			if i < 0 {
				break
			}
			rest = rest[i+len(key):]
			nums, ok := boxNumbers(rest)
			if !ok {
				continue
			}
			w := nums[2] - nums[0]
			h := nums[3] - nums[1]
			if w < 0 {
				w = -w
			}
			if h < 0 {
				h = -h
			}
			if w > MaxPagePoints || h > MaxPagePoints {
				return true
			}
		}
	}
	return false
}

func boxNumbers(s []byte) ([4]float64, bool) {
	var out [4]float64
	i := 0
	for i < len(s) && unicode.IsSpace(rune(s[i])) {
		i++
	}
	if i < len(s) && s[i] == '[' {
		i++
	}
	for n := 0; n < 4; n++ {
		for i < len(s) && (unicode.IsSpace(rune(s[i])) || s[i] == ',') {
			i++
		}
		start := i
		for i < len(s) && (s[i] == '+' || s[i] == '-' || s[i] == '.' || (s[i] >= '0' && s[i] <= '9')) {
			i++
		}
		if start == i {
			return out, false
		}
		v, err := strconv.ParseFloat(string(s[start:i]), 64)
		if err != nil {
			return out, false
		}
		out[n] = v
	}
	return out, true
}

// PixelsOK is the shared pixel budget for a rendered page and an uploaded image.
func PixelsOK(w, h int) bool {
	if w <= 0 || h <= 0 {
		return false
	}
	if w > MaxRasterSide || h > MaxRasterSide {
		return false
	}
	if w*h > MaxRasterPixels {
		return false
	}
	return true
}
