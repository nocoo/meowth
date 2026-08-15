package agent

import (
	"context"
	"sync"
)

// messagePipe is a lossless, non-blocking fan-in for backend event
// producers. Send never blocks the protocol scanner; a relay drains
// an unbounded queue onto the receive channel.
//
// Close ends the producer side. After Close, the relay delivers every
// remaining item with blocking sends so a normal successful run cannot
// lose its tail when runCtx is cancelled during backend cleanup.
//
// If ctx is cancelled while the producer is still open and the relay
// cannot deliver (no consumer), the relay abandons the queue so an
// HTTP disconnect cannot pin memory forever.
type messagePipe struct {
	ctx  context.Context
	out  chan Message
	wake chan struct{}

	mu     sync.Mutex
	q      []Message
	closed bool
}

func newMessagePipe(ctx context.Context) *messagePipe {
	if ctx == nil {
		ctx = context.Background()
	}
	p := &messagePipe{
		ctx:  ctx,
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

func (p *messagePipe) pop() (msg Message, ok bool, closed bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if len(p.q) == 0 {
		return Message{}, false, p.closed
	}
	msg = p.q[0]
	p.q[0] = Message{}
	p.q = p.q[1:]
	return msg, true, p.closed
}

func (p *messagePipe) abandon() {
	p.mu.Lock()
	p.closed = true
	p.q = nil
	p.mu.Unlock()
}

func (p *messagePipe) loop() {
	defer close(p.out)
	for {
		msg, ok, closed := p.pop()
		if ok {
			if closed {
				// Final drain after Close: blocking deliver.
				p.out <- msg
				continue
			}
			select {
			case p.out <- msg:
			case <-p.ctx.Done():
				// Backend cleanup often Close()s then cancel()s. If
				// Close already won, finish a blocking drain instead
				// of abandoning a successful transcript.
				p.mu.Lock()
				nowClosed := p.closed
				p.mu.Unlock()
				if nowClosed {
					p.out <- msg
					continue
				}
				// Producer still open, consumer gone.
				p.abandon()
				return
			}
			continue
		}
		// Queue empty.
		if closed {
			return
		}
		// Wait for Send, Close, or (if consumer already gone) stay
		// parked until the producer Closes — do not exit solely on
		// ctx cancel while the producer may still Send.
		select {
		case <-p.wake:
		case <-p.ctx.Done():
			// Soft signal only: wake loop to re-check queue/closed.
			// Actual abandon happens on blocked deliver above.
			select {
			case <-p.wake:
			case <-p.ctx.Done():
				// If still empty+open, keep waiting on wake only so a
				// cancelled-but-still-producing backend can Close.
				<-p.wake
			}
		}
	}
}
