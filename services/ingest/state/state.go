// Package state is the CV ingest state machine.
//
//	uploaded → text_extracted → parsed → deduped → ready_for_to_rate
//	uploaded → ocr_needed → ocr_done → parsed → deduped → ready_for_to_rate
//
// Every non-terminal state can also move to error_queue (the Toast
// sourcing-error queue). The only way out of error_queue is a retry, which
// re-enters at uploaded. ready_for_to_rate is terminal.
package state

// State is one step of the machine. Values are stable wire strings.
type State string

const (
	Uploaded       State = "uploaded"
	TextExtracted  State = "text_extracted"
	OCRNeeded      State = "ocr_needed"
	OCRDone        State = "ocr_done"
	Parsed         State = "parsed"
	Deduped        State = "deduped"
	ReadyForToRate State = "ready_for_to_rate"
	ErrorQueue     State = "error_queue"
)

// Reason is a stable code stored on the sourcing-error queue.
// A reason is never a snippet of the CV.
type Reason string

const (
	ReasonEmptyFile        Reason = "empty_file"
	ReasonFileTooLarge     Reason = "file_too_large"
	ReasonUnreadable       Reason = "unreadable_document"
	ReasonExtractFailed    Reason = "extract_failed"
	ReasonOCRFailed        Reason = "ocr_failed"
	ReasonOCRUnavailable   Reason = "ocr_unavailable"
	ReasonParseFailed      Reason = "parse_failed"
	ReasonUnsanctioned     Reason = "unsanctioned_source"
	ReasonUnknownFolder    Reason = "unknown_folder"
	ReasonUnknownDocType   Reason = "unknown_doc_type"
	ReasonDedupeFailed     Reason = "dedupe_failed"
	ReasonSinkFailed       Reason = "source_sink_failed"
	ReasonRetriesExhausted Reason = "retries_exhausted"
	ReasonRawExpired       Reason = "raw_expired"
)

// allowed[from][to] is the explicit edge list. Ready has no outbound edge.
var allowed = map[State]map[State]bool{
	Uploaded: {
		TextExtracted: true,
		OCRNeeded:     true,
		ErrorQueue:    true,
	},
	TextExtracted: {
		Parsed:     true,
		ErrorQueue: true,
	},
	OCRNeeded: {
		OCRDone:    true,
		ErrorQueue: true,
	},
	OCRDone: {
		Parsed:     true,
		ErrorQueue: true,
	},
	Parsed: {
		Deduped:    true,
		ErrorQueue: true,
	},
	Deduped: {
		ReadyForToRate: true,
		ErrorQueue:     true,
	},
	ErrorQueue: {
		Uploaded: true,
	},
}

// Machine is the position of one upload. The zero value is not started;
// use Start.
type Machine struct {
	cur     State
	history []State
}

// Start begins a document at uploaded.
func Start() *Machine {
	return &Machine{cur: Uploaded, history: []State{Uploaded}}
}

// Current is the state the document is in.
func (m *Machine) Current() State {
	if m == nil {
		return ""
	}
	return m.cur
}

// History is a copy of every state entered, including the start state.
func (m *Machine) History() []State {
	if m == nil {
		return nil
	}
	out := make([]State, len(m.history))
	copy(out, m.history)
	return out
}

// Clone returns an independent machine at the same position.
func (m *Machine) Clone() *Machine {
	if m == nil {
		return Start()
	}
	return &Machine{cur: m.cur, history: append([]State(nil), m.history...)}
}

// Enter moves along an explicit edge. A refused move leaves the machine
// unchanged.
func (m *Machine) Enter(next State) error {
	if m == nil {
		return illegal("", next)
	}
	if !allowed[m.cur][next] {
		return illegal(m.cur, next)
	}
	m.cur = next
	m.history = append(m.history, next)
	return nil
}

type transitionError struct {
	from State
	to   State
}

func illegal(from, to State) error {
	return transitionError{from: from, to: to}
}

func (e transitionError) Error() string {
	return "state: illegal transition " + string(e.from) + " -> " + string(e.to)
}
