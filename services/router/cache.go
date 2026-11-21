package router

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strconv"
	"sync"
	"time"
)

type stored struct {
	text       string
	confidence float64
	tier       Tier
}

type cacheEntry struct {
	stored  stored
	expires time.Time
}

type resultCache struct {
	mu    sync.Mutex
	items map[string]cacheEntry
}

func newResultCache() *resultCache {
	return &resultCache{items: make(map[string]cacheEntry)}
}

func (c *resultCache) get(key string, now time.Time) (stored, bool) {
	if c == nil {
		return stored{}, false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.items[key]
	if !ok {
		return stored{}, false
	}
	if !now.Before(e.expires) {
		delete(c.items, key)
		return stored{}, false
	}
	return e.stored, true
}

func (c *resultCache) set(key string, value stored, expires time.Time) {
	if c == nil || key == "" {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.items[key] = cacheEntry{stored: value, expires: expires}
}

func (c *resultCache) len() int {
	if c == nil {
		return 0
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.items)
}

// cacheKey is a SHA-256 of the decision inputs. The request id is not part
// of the key, so a replay of the same content hits. Field order does not
// matter. The threshold and policy version are included because they change
// which tier is allowed to answer.
func cacheKey(cfg Config, req Request) string {
	h := sha256.New()
	write := func(s string) {
		fmt.Fprintf(h, "%d:%s\n", len(s), s)
	}
	write(cfg.PolicyVersion)
	write(strconv.FormatFloat(cfg.ConfidenceThreshold, 'f', 6, 64))
	write(strconv.Itoa(req.MaxTokens))
	write(string(req.Task))
	write(req.Input)
	write(strconv.FormatBool(req.Shortlisted))
	if len(req.Fields) > 0 {
		keys := make([]string, 0, len(req.Fields))
		for k := range req.Fields {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			write(k)
			write(req.Fields[k])
		}
	}
	sum := h.Sum(nil)
	return hex.EncodeToString(sum)
}
