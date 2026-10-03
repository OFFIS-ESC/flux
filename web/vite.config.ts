import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // host: true bindet an alle Netzwerk-Interfaces (0.0.0.0),
    // damit der Dev-Server auch von anderen Geräten im LAN erreichbar ist
    // (sonst nur localhost / 127.0.0.1).
    host: true,
    // Im Dev-Modus Anfragen ans Backend (Port 3000) durchreichen.
    // localhost ist hier korrekt: der Vite-Server (auf dem Mac) leitet
    // intern an das ebenfalls auf dem Mac laufende Backend weiter.
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      // Emulierte Shelly-Schnittstelle (Senken) ebenfalls ans Backend.
      "/sink": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
