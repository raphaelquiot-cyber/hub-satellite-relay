import { createServer } from 'http'
import { WebSocketServer } from 'ws'
import { URL } from 'url'
import { RoomManager, Role } from './RoomManager'
import { TokenValidator } from './TokenValidator'

const PORT    = parseInt(process.env['PORT'] ?? '4000', 10)
const rooms   = new RoomManager()
const validator = new TokenValidator()

// ─── Serveur HTTP minimal (health-check) ──────────────────────────────────────

const httpServer = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({
    status:    'ok',
    rooms:     rooms.roomCount,
    timestamp: new Date().toISOString(),
  }))
})

// ─── Serveur WebSocket ────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server: httpServer })

wss.on('connection', (ws, req) => {
  // Extraction des paramètres depuis l'URL de connexion
  // ws://localhost:4000?token=TOKEN&role=hub
  const reqUrl = new URL(req.url ?? '/', `ws://localhost:${PORT}`)
  const token  = reqUrl.searchParams.get('token') ?? ''
  const role   = reqUrl.searchParams.get('role') as Role | null
  const ip     = req.socket.remoteAddress ?? 'unknown'

  // Validation du rôle
  if (role !== 'hub' && role !== 'satellite') {
    console.warn(`[relay] reject  ip=${ip} reason=invalid_role`)
    ws.close(1008, 'Paramètre role invalide — attendu: hub ou satellite')
    return
  }

  // Validation du token — contenu jamais loggé
  if (!validator.isValid(token)) {
    console.warn(`[relay] reject  ip=${ip} role=${role} reason=invalid_token`)
    ws.close(1008, 'Token invalide ou trop court')
    return
  }

  // Raccourci pour les logs — n'expose que les 8 premiers caractères
  const tokenHint = `${token.slice(0, 8)}…`
  console.log(`[relay] connect    role=${role} token=${tokenHint} ip=${ip} rooms=${rooms.roomCount + 1}`)

  rooms.join(token, role, ws)

  ws.on('message', (data) => {
    // Retransmission pure — le contenu n'est jamais loggé ni inspecté.
    // Point d'extension pour chiffrement E2E futur : déchiffrer ici avant relay,
    // ou simplement passer le payload chiffré tel quel (opaque forwarding).
    rooms.relay(token, role, data)
  })

  ws.on('close', () => {
    console.log(`[relay] disconnect role=${role} token=${tokenHint} rooms=${rooms.roomCount - 1}`)
    rooms.leave(token, role)
  })

  ws.on('error', (err) => {
    console.error(`[relay] error      role=${role} token=${tokenHint} message=${err.message}`)
  })
})

// ─── Démarrage ────────────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`[relay] WebSocket relay démarré — ws://localhost:${PORT}`)
  console.log(`[relay] Health-check HTTP       — http://localhost:${PORT}`)
  console.log(`[relay] Connexion Hub       : ws://localhost:${PORT}?token=TOKEN&role=hub`)
  console.log(`[relay] Connexion Satellite : ws://localhost:${PORT}?token=TOKEN&role=satellite`)
})
