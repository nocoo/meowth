package agent

import (
	"sync"
)

// messagePipe is a lossless, non-blocking fan-in for backend event
// producers. Send never blocks the protocol scanner; a relay drains
// an unbounded in-memory queue onto the receive channel.
//
// Close ends the producer side. After Close the relay delivers every
// remaining queued message with blocking sends. The HTTP exec pump
// must keep reading Messages until the channel closes (including on
// client disconnect — see exec_pump drain on ctx.Done) so the relay
// cannot pin forever without a consumer.
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

func (p *messagePipe) Send(msg Message) {
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return
	}
	p.q = append(p.q, msg)
	p.mu.Unlock()
	p.kick()
}

func (p *messagePipe) Close() {
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return
	}
	p.closed = true
	p.mu.Unlock()
	p.kick()
}

func (p *messagePipe) kick() {
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
		if len(p.q) == 0 {
			p.mu.Unlock()
			return
		}
		msg := p.q[0]
		p.q[0] = Message{}
		p.q = p.q[1:]
		p.mu.Unlock()
		p.out <- msg
	}
}
