package ocr

import (
	"encoding/binary"

	"github.com/mysticalsin/aria-sourcing/services/ingest/extract"
)

// ErrImageLimits means the raster is outside the pixel cap. Tesseract is
// not started. The error string is a code.
var ErrImageLimits = errImageLimits{}

type errImageLimits struct{}

func (errImageLimits) Error() string { return "image_limits" }

// imageWithinCaps reads PNG or JPEG dimensions and refuses anything over
// the shared raster budget. Unknown containers are refused too: a file we
// cannot measure is not passed to Tesseract.
func imageWithinCaps(image []byte) error {
	w, h, ok := imageSize(image)
	if !ok || !extract.PixelsOK(w, h) {
		return ErrImageLimits
	}
	return nil
}

func imageSize(image []byte) (int, int, bool) {
	if w, h, ok := pngSize(image); ok {
		return w, h, true
	}
	return jpegSize(image)
}

func pngSize(b []byte) (int, int, bool) {
	if len(b) < 24 || b[0] != 0x89 || b[1] != 'P' || b[2] != 'N' || b[3] != 'G' {
		return 0, 0, false
	}
	if string(b[12:16]) != "IHDR" {
		return 0, 0, false
	}
	w := int(binary.BigEndian.Uint32(b[16:20]))
	h := int(binary.BigEndian.Uint32(b[20:24]))
	return w, h, true
}

func jpegSize(b []byte) (int, int, bool) {
	if len(b) < 4 || b[0] != 0xFF || b[1] != 0xD8 {
		return 0, 0, false
	}
	i := 2
	for i+8 < len(b) {
		if b[i] != 0xFF {
			return 0, 0, false
		}
		for i < len(b) && b[i] == 0xFF {
			i++
		}
		if i >= len(b) {
			return 0, 0, false
		}
		marker := b[i]
		i++
		if marker == 0xD8 || marker == 0xD9 || marker == 0x01 || (marker >= 0xD0 && marker <= 0xD7) {
			continue
		}
		if i+1 >= len(b) {
			return 0, 0, false
		}
		seglen := int(b[i])<<8 | int(b[i+1])
		if sof(marker) {
			if i+7 >= len(b) {
				return 0, 0, false
			}
			h := int(b[i+3])<<8 | int(b[i+4])
			w := int(b[i+5])<<8 | int(b[i+6])
			return w, h, true
		}
		if seglen < 2 || i+seglen > len(b) {
			return 0, 0, false
		}
		i += seglen
	}
	return 0, 0, false
}

func sof(marker byte) bool {
	switch marker {
	case 0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF:
		return true
	default:
		return false
	}
}
