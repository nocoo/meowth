package server

import (
	"context"
	"sync/atomic"
	"testing"
)

func TestCancelRegistryFirstCallFiresOutcomeFired(t *testing.T) {
	r := newCancelRegistry()
	var fired int32
	r.Register("sess-1", func() { atomic.AddInt32(&fired, 1) })
	out := r.Cancel("sess-1")
	if out != CancelOutcomeFired {
		t.Fatalf("first Cancel = %v, want Fired", out)
	}
	if atomic.LoadInt32(&fired) != 1 {
		t.Fatalf("CancelFunc invocations = %d, want 1", fired)
	}
}

func TestCancelRegistrySecondCallReportsAlreadyRequested(t *testing.T) {
	r := newCancelRegistry()
	var fired int32
	r.Register("sess-1", func() { atomic.AddInt32(&fired, 1) })
	_ = r.Cancel("sess-1")
	out := r.Cancel("sess-1")
	if out != CancelOutcomeAlreadyRequested {
		t.Fatalf("second Cancel = %v, want AlreadyRequested", out)
	}
	if atomic.LoadInt32(&fired) != 1 {
		t.Fatalf("CancelFunc must not fire twice; invocations = %d", fired)
	}
}

func TestCancelRegistryUnknownSession(t *testing.T) {
	r := newCancelRegistry()
	if out := r.Cancel("nope"); out != CancelOutcomeUnknown {
		t.Fatalf("out = %v, want Unknown", out)
	}
}

func TestCancelRegistryUnregisterClearsState(t *testing.T) {
	r := newCancelRegistry()
	unreg := r.Register("sess-1", func() {})
	_ = r.Cancel("sess-1")
	unreg()
	// Re-register the same id: a fresh CancelFunc should fire.
	var fired int32
	r.Register("sess-1", func() { atomic.AddInt32(&fired, 1) })
	if out := r.Cancel("sess-1"); out != CancelOutcomeFired {
		t.Fatalf("after re-register: out = %v, want Fired", out)
	}
	if atomic.LoadInt32(&fired) != 1 {
		t.Fatalf("fired = %d", fired)
	}
}

func TestCancelRegistryCancelAllSkipsAlreadyRequested(t *testing.T) {
	r := newCancelRegistry()
	var firedA, firedB int32
	r.Register("A", func() { atomic.AddInt32(&firedA, 1) })
	r.Register("B", func() { atomic.AddInt32(&firedB, 1) })
	_ = r.Cancel("A") // mark A as already-requested
	n := r.CancelAll()
	if n != 1 {
		t.Fatalf("CancelAll = %d, want 1 (B only)", n)
	}
	if atomic.LoadInt32(&firedA) != 1 || atomic.LoadInt32(&firedB) != 1 {
		t.Fatalf("firedA=%d firedB=%d", firedA, firedB)
	}
	// A second CancelAll fires nothing.
	if n := r.CancelAll(); n != 0 {
		t.Fatalf("second CancelAll = %d, want 0", n)
	}
}

func TestCancelRegistryUserCancelDoesNotMarkShutdown(t *testing.T) {
	r := newCancelRegistry()
	r.Register("sess-1", func() {})
	_ = r.Cancel("sess-1")
	if r.IsShutdown("sess-1") {
		t.Fatal("user cancel must NOT mark shutdown")
	}
}

func TestCancelRegistryCancelAllMarksShutdown(t *testing.T) {
	r := newCancelRegistry()
	r.Register("sess-A", func() {})
	r.Register("sess-B", func() {})
	r.CancelAll()
	if !r.IsShutdown("sess-A") || !r.IsShutdown("sess-B") {
		t.Fatal("CancelAll did not mark sessions as shutdown")
	}
}

func TestCancelRegistryCancelAllSkipsUserCancelledShutdownFlag(t *testing.T) {
	// A session already user-cancelled should NOT be re-marked
	// as shutdown by CancelAll; the user-cancel terminal status
	// (cancelled) is what the operator initiated.
	r := newCancelRegistry()
	r.Register("sess-user", func() {})
	r.Register("sess-shutdown", func() {})
	_ = r.Cancel("sess-user")
	r.CancelAll()
	if r.IsShutdown("sess-user") {
		t.Fatal("user-cancelled session re-marked as shutdown")
	}
	if !r.IsShutdown("sess-shutdown") {
		t.Fatal("shutdown-only session not marked as shutdown")
	}
}

// silence unused import in case future refactors drop the context
// reference from tests.
var _ = context.Background
