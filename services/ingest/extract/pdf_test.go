package extract

import (
	"strings"
	"testing"
)

func TestRoundTripTextLayer(t *testing.T) {
	lines := []string{
		"Name: Casey Example",
		"Email: casey.sample@example.test",
		"Built a stream processor",
		"Company: Example (EMEA) Consulting",
		`Path: C:\cvs\one`,
	}
	for _, compress := range []bool{false, true} {
		pdf := buildTextPDF(lines, compress)
		got, err := ExtractText(pdf)
		if err != nil {
			t.Fatalf("compress=%v: %v", compress, err)
		}
		if got != strings.Join(lines, "\n") {
			t.Fatalf("compress=%v:\n got %q\nwant %q", compress, got, strings.Join(lines, "\n"))
		}
	}
}

func TestContentOperators(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"(Hello) Tj", "Hello"},
		{"(A) Tj\nT*\n(B) Tj", "A\nB"},
		{"(A) Tj (B) Tj", "AB"},
		{`[(Hi) -200 (there)] TJ`, "Hi there"},
		{`[(Hi) 20 (there)] TJ`, "Hithere"},
		{`(parens \(ok\)) Tj`, "parens (ok)"},
		{"<4869> Tj", "Hi"},
		{"BT\nET\n", ""},
	}
	for _, tc := range cases {
		if got := contentText(tc.in); got != tc.want {
			t.Fatalf("content %q:\n got %q\nwant %q", tc.in, got, tc.want)
		}
	}
}

func TestCorruptAndEmpty(t *testing.T) {
	if _, err := ExtractText([]byte("not a pdf")); !errorsIsUnreadable(err) {
		t.Fatalf("random: %v", err)
	}
	if _, err := ExtractText([]byte("%PDF-1.4\nthis is not a body")); !errorsIsUnreadable(err) {
		t.Fatalf("truncated: %v", err)
	}
	broken := []byte("%PDF-1.4\n1 0 obj\n<< /Length 8 /Filter /FlateDecode >>\nstream\nGARBAGE!\nendstream\nendobj\n")
	if _, err := ExtractText(broken); !errorsIsUnreadable(err) {
		t.Fatalf("bad flate: %v", err)
	}
	empty, err := ExtractText(BuildTextPDF(nil))
	if err != nil {
		t.Fatal(err)
	}
	if EnoughText(empty) {
		t.Fatalf("empty page looked like text %q", empty)
	}
	if !EnoughText("Name: Casey Example") {
		t.Fatal("a labeled name line should count as a text layer")
	}
}

func TestSniff(t *testing.T) {
	if Sniff([]byte("%PDF-1.4")) != KindPDF {
		t.Fatal("pdf")
	}
	if Sniff([]byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}) != KindPNG {
		t.Fatal("png")
	}
	if Sniff([]byte{0xFF, 0xD8, 0xFF, 0xD9}) != KindJPEG {
		t.Fatal("jpeg")
	}
	if Sniff([]byte("hello")) != KindUnknown {
		t.Fatal("unknown")
	}
}

func errorsIsUnreadable(err error) bool {
	return err != nil && (err == ErrUnreadable || strings.Contains(err.Error(), ErrUnreadable.Error()))
}
