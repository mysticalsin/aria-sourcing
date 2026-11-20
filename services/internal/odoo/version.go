package odoo

import "strings"

// NormalizeVersion accepts 18, 18.0, 19, 19.0, and empty (19).
// The returned error does not include the raw value.
func NormalizeVersion(v string) (string, error) {
	switch strings.TrimSpace(v) {
	case "", "19", "19.0":
		return "19", nil
	case "18", "18.0":
		return "18", nil
	default:
		return "", errVersion
	}
}

var errVersion = errString("odoo version must be 18 or 19")

type errString string

func (e errString) Error() string { return string(e) }

// PersonRecordModel is the Odoo model UpsertPerson writes.
// Odoo 18 stores hr.candidate. Odoo 19 removed it and uses hr.applicant.
func PersonRecordModel(version string) string {
	if version == "18" {
		return "hr.candidate"
	}
	return "hr.applicant"
}
