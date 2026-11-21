package aria

import "encoding/json"

func jsonUnmarshal(buf []byte, dest any) error {
	return json.Unmarshal(buf, dest)
}
