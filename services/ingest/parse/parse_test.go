package parse

import "testing"

func TestYearRangeIsNotAPhone(t *testing.T) {
	cv, ok := Parse("Name: Casey Example\nExperience:\n2022-2024 | Recruiter | Example Consulting\n")
	if !ok {
		t.Fatal("expected a parse")
	}
	if cv.Contact.Phone != "" {
		t.Fatalf("year range became phone %q", cv.Contact.Phone)
	}
	if len(cv.Experience) != 1 || cv.Experience[0].Company != "Example Consulting" {
		t.Fatalf("role: %+v", cv.Experience)
	}
}

func TestHeadingLayout(t *testing.T) {
	text := "" +
		"Jordan Fixture\n" +
		"Sourcing specialist\n" +
		"Porto, Portugal\n" +
		"jordan.fixture@example.test\n" +
		"+351 21 000 0000\n" +
		"\nSKILLS\nGo\nKubernetes\nSourcing\n" +
		"\nLANGUAGES\nEnglish\nPortuguese\n" +
		"\nEXPERIENCE\nRecruiter at Example Consulting (2020-2023)\n" +
		"Researcher at Fixture Labs (2018-2020)\n" +
		"\nEDUCATION\nExample University\n"
	cv, ok := Parse(text)
	if !ok {
		t.Fatal("expected a parse")
	}
	if cv.Name != "Jordan Fixture" {
		t.Fatalf("name %q", cv.Name)
	}
	if cv.Contact.Email != "jordan.fixture@example.test" {
		t.Fatalf("email %q", cv.Contact.Email)
	}
	if NormPhone(cv.Contact.Phone) != "+351210000000" {
		t.Fatalf("phone %q", cv.Contact.Phone)
	}
	if cv.Location != "Porto, Portugal" {
		t.Fatalf("location %q", cv.Location)
	}
	if len(cv.Skills) != 3 || len(cv.Languages) != 2 || len(cv.Experience) != 2 {
		t.Fatalf("lists skills=%v lang=%v exp=%v", cv.Skills, cv.Languages, cv.Experience)
	}
	if cv.Experience[0].Title != "Recruiter" || cv.Experience[1].Company != "Fixture Labs" {
		t.Fatalf("roles %+v", cv.Experience)
	}
}

func TestNoIdentityFails(t *testing.T) {
	if _, ok := Parse("SKILLS\nGo\nKubernetes\n"); ok {
		t.Fatal("skills alone are not an identity")
	}
}
