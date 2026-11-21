package qc

// Channel identifiers accepted by Evaluate. Matching is case-insensitive
// after trimming. Any other channel fails the length check.
const (
	ChannelEmail           = "email"
	ChannelInMail          = "inmail"
	ChannelHeyReach        = "heyreach"
	ChannelHeyReachInMail  = "heyreach-inmail"
	ChannelHeyReachConnect = "heyreach-connect"
)

// Vendor and policy caps. Counts are Unicode code points, not bytes.
const (
	// InMailSubjectMax is LinkedIn's InMail subject cap.
	// https://www.linkedin.com/help/linkedin/answer/a411986/inmail-character-limits
	InMailSubjectMax = 200

	// InMailBodyMax is LinkedIn's InMail body cap. A second LinkedIn help
	// page says 2000; this gate uses the stricter published cap of 1900.
	// https://www.linkedin.com/help/linkedin/answer/a411986/inmail-character-limits
	InMailBodyMax = 1900

	// HeyReachMessageMax is the HeyReach direct-message template cap
	// (PublicMessagePayload.messages, max 8000 characters).
	// https://www.heyreach.io/blog/campaign-api
	HeyReachMessageMax = 8000

	// HeyReachInMailSubjectMax is the HeyReach InMail subject cap
	// (PublicInMailMessage.subject, max 200 characters).
	// https://www.heyreach.io/blog/campaign-api
	HeyReachInMailSubjectMax = 200

	// HeyReachInMailBodyMax is the HeyReach InMail body cap
	// (PublicInMailMessage.message, max 1900 characters).
	// https://www.heyreach.io/blog/campaign-api
	HeyReachInMailBodyMax = 1900

	// HeyReachConnectionNoteMax is the connection-note cap HeyReach documents
	// for Premium and Sales Navigator accounts. Free accounts are 200; this
	// gate cannot see the LinkedIn plan, so 300 is the documented HeyReach
	// cap and the free-account gap is a known limit.
	// https://help.heyreach.io/en/articles/10493916-what-can-be-automated-in-heyreach-sequence
	HeyReachConnectionNoteMax = 300

	// EmailSubjectMax and EmailBodyMax are Aria caps. Email has no vendor
	// character cap analogous to InMail; these bounds keep a draft finite.
	EmailSubjectMax = 200
	EmailBodyMax    = 10000
)

type channelLimit struct {
	subjectMax     int
	bodyMax        int
	subjectAllowed bool
}

// heyreach direct messages may carry a subject. The body cap is the
// documented 8000-character message cap. A subject, when present, uses the
// documented InMail subject cap of 200.
var channelLimits = map[string]channelLimit{
	ChannelEmail: {
		subjectMax:     EmailSubjectMax,
		bodyMax:        EmailBodyMax,
		subjectAllowed: true,
	},
	ChannelInMail: {
		subjectMax:     InMailSubjectMax,
		bodyMax:        InMailBodyMax,
		subjectAllowed: true,
	},
	ChannelHeyReach: {
		subjectMax:     HeyReachInMailSubjectMax,
		bodyMax:        HeyReachMessageMax,
		subjectAllowed: true,
	},
	ChannelHeyReachInMail: {
		subjectMax:     HeyReachInMailSubjectMax,
		bodyMax:        HeyReachInMailBodyMax,
		subjectAllowed: true,
	},
	ChannelHeyReachConnect: {
		subjectMax:     0,
		bodyMax:        HeyReachConnectionNoteMax,
		subjectAllowed: false,
	},
}
