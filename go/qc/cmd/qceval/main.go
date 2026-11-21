package main

import (
	"encoding/json"
	"io"
	"os"

	"github.com/mysticalsin/aria-sourcing/go/qc"
)

type request struct {
	qc.Input
	Threshold *float64 `json:"threshold"`
}

type response struct {
	Status    string      `json:"status"`
	Score     float64     `json:"score"`
	QCVersion string      `json:"qc_version"`
	DraftHash string      `json:"draft_hash"`
	Reasons   []qc.Reason `json:"reasons"`
	CapsOK    bool        `json:"caps_ok"`
}

func main() {
	raw, err := io.ReadAll(os.Stdin)
	if err != nil {
		os.Exit(2)
	}
	var req request
	if err := json.Unmarshal(raw, &req); err != nil {
		os.Exit(2)
	}
	threshold := qc.DefaultThreshold
	if req.Threshold != nil {
		threshold = *req.Threshold
	}
	result, err := qc.Evaluate(req.Input, threshold)
	if err != nil {
		os.Exit(2)
	}
	out := response{
		Status:    string(result.Status()),
		Score:     result.Score(),
		QCVersion: result.QCVersion(),
		DraftHash: result.DraftHash(),
		Reasons:   result.Reasons(),
		CapsOK:    qc.Admit(req.Draft, result) == nil,
	}
	if err := json.NewEncoder(os.Stdout).Encode(out); err != nil {
		os.Exit(2)
	}
}
