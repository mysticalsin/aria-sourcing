package interviewer

import "errors"

// Sentinel errors. Callers distinguish infrastructure failures from a
// candidate outcome: a timeout is infrastructure, never a rejection.
var (
	ErrDisabled   = errors.New("interviewer: disabled")
	ErrInfra      = errors.New("interviewer: infrastructure")
	ErrValidation = errors.New("interviewer: validation")
	ErrSignature  = errors.New("interviewer: signature")
	ErrTransition = errors.New("interviewer: illegal transition")
	ErrRemote     = errors.New("interviewer: remote")
)
