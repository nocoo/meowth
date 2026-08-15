package agent

import "sync"

// messagePipe is a lossless, non-blocking fan-in for backend event
// producers. Backends call Send from their scanner/protocol loops
// without risk of blocking on a slow HTTP/SQLite consumer; a relay
// goroutine drains an unbounded in-memory queue onto the receive
// channel the pump reads.
//
// Close must be called exactly once when the producer is done. After
// Close, Send is a no-op. The receive channel is closed only after
// every queued message has been delivered (or the process exits).
type messagePipe struct {
	out  chan Message
	wake chan struct{}

	mu     sync.Mutex
	q      []Message
	closed bool
}

func newMessagePipe() *messagePipe {
	p := &messagePipe{
		out:  make(chan Message),
		wake: make(chan struct{}, 1),
	}
	go p.loop()
	return p
}

func (p *messagePipe) C() <-chan Message { return p.out }

// Send enqueues msg without dropping and without blocking on the
// consumer. It may allocate; that is the trade for durability.
func (p *messagePipe) Send(msg Message) {
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return
	}
	p.q = append(p.q, msg)
	p.mu.Unlock()
	select {
	case p.wake <- struct{}{}:
	default:
	}
}

// Close signals end-of-stream. Safe to call once; further Send calls
// are ignored. The receive side closes after the queue drains.
func (p *messagePipe) Close() {
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return
	}
	p.closed = true
	p.mu.Unlock()
	select {
	case p.wake <- struct{}{}:
	default:
	}
}

func (p *messagePipe) loop() {
	defer close(p.out)
	for {
		p.mu.Lock()
		for len(p.q) == 0 && !p.closed {
			p.mu.Unlock()
			<-p.wake
			p.mu.Lock()
		}
		if len(p.q) == 0 && p.closed {
			p.mu.Unlock()
			return
		}
		msg := p.q[0]
		// Avoid unbounded slice growth retention: drop head reference.
		p.q[0] = Message{}
		p.q = p.q[1:]
		p.mu.Unlock()
		p.out <- msg
	}
}
