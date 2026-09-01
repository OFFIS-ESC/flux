// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// FLUX EEBUS-Sidecar
//
// Eigenständiger Go-Prozess, der die EEBUS-Kommunikation mit einer Steuerbox
// übernimmt (Rolle "Controllable System", CS) und die empfangenen §14a/§9-
// Steuerbefehle (LPC/LPP) per HTTP an den FLUX-Server weiterreicht. FLUX selbst
// bleibt Node/TypeScript; die Protokollarbeit (SHIP/SPINE/TLS/mDNS) erledigt
// dieser Sidecar über die etablierte Bibliothek github.com/enbility/eebus-go.
//
// Datenfluss:
//   Steuerbox --EEBUS--> Sidecar --HTTP POST /api/eebus/ingest--> FLUX
//   FLUX --HTTP POST /config--> Sidecar (remoteSKI setzen)
//   FLUX --HTTP GET  /status--> Sidecar (eigener SKI, Verbindungszustand)
//
// Aufruf:
//   eebus-sidecar -port 4720 -fluxurl http://127.0.0.1:3000 \
//       -certpath cert.pem -keypath key.pem [-remoteski <ski>]

package main

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/enbility/eebus-go/api"
	"github.com/enbility/eebus-go/service"
	ucapi "github.com/enbility/eebus-go/usecases/api"
	cslpc "github.com/enbility/eebus-go/usecases/cs/lpc"
	cslpp "github.com/enbility/eebus-go/usecases/cs/lpp"
	eglpc "github.com/enbility/eebus-go/usecases/eg/lpc"
	eglpp "github.com/enbility/eebus-go/usecases/eg/lpp"
	shipapi "github.com/enbility/ship-go/api"
	"github.com/enbility/ship-go/cert"
	spineapi "github.com/enbility/spine-go/api"
	"github.com/enbility/spine-go/model"
)

type sidecar struct {
	myService *service.Service
	uccslpc   ucapi.CsLPCInterface
	uccslpp   ucapi.CsLPPInterface

	fluxURL   string
	remoteSki string
	ownSki    string

	mu        sync.Mutex
	connected bool
}

type ingestMsg struct {
	Kind    string   `json:"kind"`
	UseCase string   `json:"useCase"`
	Aktiv   bool     `json:"aktiv"`
	Wert    float64  `json:"wert"`
	DauerS  *float64 `json:"dauerSek"`
	OwnSki  string   `json:"ownSki,omitempty"`
	Ski     string   `json:"ski,omitempty"`
}

func (s *sidecar) sendToFlux(m ingestMsg) {
	body, _ := json.Marshal(m)
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Post(s.fluxURL+"/api/eebus/ingest", "application/json", bytes.NewReader(body))
	if err != nil {
		log.Printf("ingest an FLUX fehlgeschlagen: %v", err)
		return
	}
	_ = resp.Body.Close()
}

func (s *sidecar) setup(port int, certPath, keyPath string) error {
	var certificate tls.Certificate
	var err error

	if fileExists(certPath) && fileExists(keyPath) {
		certificate, err = tls.LoadX509KeyPair(certPath, keyPath)
		if err != nil {
			return fmt.Errorf("Zertifikat laden: %w", err)
		}
	} else {
		certificate, err = cert.CreateCertificate("FLUX", "FLUX", "DE", "FLUX-HEMS-01")
		if err != nil {
			return fmt.Errorf("Zertifikat erzeugen: %w", err)
		}
		if err := saveCertificate(certificate, certPath, keyPath); err != nil {
			return fmt.Errorf("Zertifikat speichern: %w", err)
		}
	}

	configuration, err := api.NewConfiguration(
		"FLUX", "FLUX", "HEMS", "FLUX-HEMS-01",
		model.DeviceTypeTypeEnergyManagementSystem,
		[]model.EntityTypeType{model.EntityTypeTypeCEM},
		port, certificate, time.Second*4)
	if err != nil {
		return err
	}
	configuration.SetAlternateIdentifier("FLUX-HEMS-01")

	s.myService = service.NewService(configuration, s)
	s.myService.SetLogging(quietLogger{})
	if err := s.myService.Setup(); err != nil {
		return err
	}

	s.ownSki = s.myService.LocalService().SKI()

	localEntity := s.myService.LocalDevice().EntityForType(model.EntityTypeTypeCEM)
	s.uccslpc = cslpc.NewLPC(localEntity, s.onLPCEvent)
	s.myService.AddUseCase(s.uccslpc)
	s.uccslpp = cslpp.NewLPP(localEntity, s.onLPPEvent)
	s.myService.AddUseCase(s.uccslpp)
	s.myService.AddUseCase(eglpc.NewLPC(localEntity, nil))
	s.myService.AddUseCase(eglpp.NewLPP(localEntity, nil))

	_ = s.uccslpc.SetConsumptionNominalMax(30000)
	_ = s.uccslpc.SetConsumptionLimit(ucapi.LoadLimit{Value: 4200, IsChangeable: true, IsActive: false})
	_ = s.uccslpc.SetFailsafeConsumptionActivePowerLimit(4200, true)
	_ = s.uccslpc.SetFailsafeDurationMinimum(2*time.Hour, true)

	_ = s.uccslpp.SetProductionNominalMax(30000)
	_ = s.uccslpp.SetProductionLimit(ucapi.LoadLimit{Value: 0, IsChangeable: true, IsActive: false})
	_ = s.uccslpp.SetFailsafeProductionActivePowerLimit(0, true)
	_ = s.uccslpp.SetFailsafeDurationMinimum(2*time.Hour, true)

	if s.remoteSki != "" {
		s.myService.RegisterRemoteSKI(s.remoteSki)
	}
	s.myService.Start()
	return nil
}

func (s *sidecar) onLPCEvent(ski string, device spineapi.DeviceRemoteInterface, entity spineapi.EntityRemoteInterface, event api.EventType) {
	if entity.EntityType() != model.EntityTypeTypeGridGuard {
		return
	}
	switch event {
	case cslpc.WriteApprovalRequired:
		// Eingehende Schreibanfrage(n) genehmigen. Die Weiterleitung an FLUX
		// erfolgt NICHT hier, sondern ausschliesslich ueber DataUpdateLimit (der
		// den tatsaechlich uebernommenen Limit-Zustand liefert). Sonst wuerde
		// jedes Kommando doppelt gemeldet (Approval + Datenupdate).
		for msgCounter := range s.uccslpc.PendingConsumptionLimits() {
			s.uccslpc.ApproveOrDenyConsumptionLimit(msgCounter, true, "")
		}
	case cslpc.DataUpdateLimit:
		if limit, err := s.uccslpc.ConsumptionLimit(); err == nil {
			s.forwardLimit("lpc", limit)
		}
	case cslpc.DataUpdateHeartbeat:
		s.sendToFlux(ingestMsg{Kind: "heartbeat", UseCase: "lpc"})
	}
}

func (s *sidecar) onLPPEvent(ski string, device spineapi.DeviceRemoteInterface, entity spineapi.EntityRemoteInterface, event api.EventType) {
	if entity.EntityType() != model.EntityTypeTypeGridGuard {
		return
	}
	switch event {
	case cslpp.WriteApprovalRequired:
		// Analog zu LPC: nur genehmigen, Weiterleitung ueber DataUpdateLimit.
		for msgCounter := range s.uccslpp.PendingProductionLimits() {
			s.uccslpp.ApproveOrDenyProductionLimit(msgCounter, true, "")
		}
	case cslpp.DataUpdateLimit:
		if limit, err := s.uccslpp.ProductionLimit(); err == nil {
			s.forwardLimit("lpp", limit)
		}
	case cslpp.DataUpdateHeartbeat:
		s.sendToFlux(ingestMsg{Kind: "heartbeat", UseCase: "lpp"})
	}
}

func (s *sidecar) forwardLimit(useCase string, limit ucapi.LoadLimit) {
	var dauer *float64
	if limit.Duration > 0 {
		d := limit.Duration.Seconds()
		dauer = &d
	}
	s.sendToFlux(ingestMsg{
		Kind: "limit", UseCase: useCase,
		Aktiv: limit.IsActive, Wert: limit.Value, DauerS: dauer,
	})
}

func (s *sidecar) RemoteSKIConnected(_ api.ServiceInterface, ski string) {
	s.mu.Lock()
	s.connected = true
	s.mu.Unlock()
	s.sendToFlux(ingestMsg{Kind: "connect", Ski: ski})
}
func (s *sidecar) RemoteSKIDisconnected(_ api.ServiceInterface, ski string) {
	s.mu.Lock()
	s.connected = false
	s.mu.Unlock()
	s.sendToFlux(ingestMsg{Kind: "disconnect", Ski: ski})
}
func (s *sidecar) VisibleRemoteServicesUpdated(_ api.ServiceInterface, _ []shipapi.RemoteService) {
}
func (s *sidecar) ServiceShipIDUpdate(_ string, _ string) {}
func (s *sidecar) ServicePairingDetailUpdate(ski string, detail *shipapi.ConnectionStateDetail) {
	if ski == s.remoteSki && detail.State() == shipapi.ConnectionStateRemoteDeniedTrust {
		log.Println("Gegenstelle hat Vertrauen verweigert.")
		s.myService.CancelPairingWithSKI(ski)
		s.myService.UnregisterRemoteSKI(ski)
	}
}
func (s *sidecar) AllowWaitingForTrust(ski string) bool { return ski == s.remoteSki }

func (s *sidecar) serveHTTP(addr string) {
	mux := http.NewServeMux()
	mux.HandleFunc("/status", func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		conn := s.connected
		s.mu.Unlock()
		writeJSON(w, map[string]any{"ownSki": s.ownSki, "remoteSki": s.remoteSki, "connected": conn})
	})
	mux.HandleFunc("/config", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			RemoteSki string `json:"remoteSki"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if body.RemoteSki != "" && body.RemoteSki != s.remoteSki {
			if s.remoteSki != "" {
				s.myService.UnregisterRemoteSKI(s.remoteSki)
			}
			s.remoteSki = body.RemoteSki
			s.myService.RegisterRemoteSKI(s.remoteSki)
		}
		writeJSON(w, map[string]any{"ok": true, "remoteSki": s.remoteSki})
	})
	log.Printf("Sidecar-HTTP auf %s", addr)
	_ = http.ListenAndServe(addr, mux)
}

func fileExists(p string) bool {
	if p == "" {
		return false
	}
	_, err := os.Stat(p)
	return err == nil
}

func saveCertificate(c tls.Certificate, certPath, keyPath string) error {
	certPem := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: c.Certificate[0]})
	if err := os.WriteFile(certPath, certPem, 0600); err != nil {
		return err
	}
	b, err := x509.MarshalECPrivateKey(c.PrivateKey.(*ecdsa.PrivateKey))
	if err != nil {
		return err
	}
	keyPem := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: b})
	return os.WriteFile(keyPath, keyPem, 0600)
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

type quietLogger struct{}

func (quietLogger) Trace(args ...interface{})                 {}
func (quietLogger) Tracef(format string, args ...interface{}) {}
func (quietLogger) Debug(args ...interface{})                 {}
func (quietLogger) Debugf(format string, args ...interface{}) {}
func (quietLogger) Info(args ...interface{})                  {}
func (quietLogger) Infof(format string, args ...interface{})  {}
func (quietLogger) Error(args ...interface{})                 {}
func (quietLogger) Errorf(format string, args ...interface{}) {}

func main() {
	port := flag.Int("port", 4720, "EEBUS-Serverport (SHIP)")
	httpAddr := flag.String("http", "127.0.0.1:4721", "HTTP-Steuerschnittstelle für FLUX")
	fluxURL := flag.String("fluxurl", "http://127.0.0.1:3000", "FLUX-Basis-URL für Ingest")
	certPath := flag.String("certpath", "eebus-cert.pem", "Pfad zum Zertifikat")
	keyPath := flag.String("keypath", "eebus-key.pem", "Pfad zum privaten Schlüssel")
	remoteSki := flag.String("remoteski", "", "SKI der Steuerbox (optional beim Start)")
	flag.Parse()

	s := &sidecar{fluxURL: *fluxURL, remoteSki: *remoteSki}
	if err := s.setup(*port, *certPath, *keyPath); err != nil {
		log.Fatalf("Setup fehlgeschlagen: %v", err)
	}
	log.Printf("Eigener SKI: %s", s.ownSki)
	s.sendToFlux(ingestMsg{Kind: "own", OwnSki: s.ownSki})
	s.serveHTTP(*httpAddr)
}
