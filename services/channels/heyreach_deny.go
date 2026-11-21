package channels

import "strings"

// heyReachDeniedEndpoints are HeyReach methods Aria must never call.
// ConnectWithCookies and UpdateProxy, including their public URL paths.
var heyReachDeniedEndpoints = []string{
	"ConnectWithCookies",
	"UpdateProxy",
	"/api/public/li_account/ConnectWithCookies",
	"/api/public/li_account/UpdateProxy",
}

func heyReachPathDenied(raw string) bool {
	folded := strings.ToLower(raw)
	for _, name := range heyReachDeniedEndpoints {
		if strings.Contains(folded, strings.ToLower(name)) {
			return true
		}
	}
	return false
}
