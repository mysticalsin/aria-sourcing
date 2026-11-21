package qc

// Channel identifiers accepted by the gate. Numeric caps are filled in with
// the implementation; the red stub leaves them at zero so the spec tests fail.
const (
	ChannelEmail           = "email"
	ChannelInMail          = "inmail"
	ChannelHeyReach        = "heyreach"
	ChannelHeyReachInMail  = "heyreach-inmail"
	ChannelHeyReachConnect = "heyreach-connect"
)

const (
	InMailSubjectMax          = 0
	InMailBodyMax             = 0
	HeyReachMessageMax        = 0
	HeyReachInMailSubjectMax  = 0
	HeyReachInMailBodyMax     = 0
	HeyReachConnectionNoteMax = 0
	EmailSubjectMax           = 0
	EmailBodyMax              = 0
)
