import { WebSocket, RawData } from 'ws'

export type Role = 'hub' | 'satellite'

interface Room {
  hub:       WebSocket | null
  satellite: WebSocket | null
}

// Message système envoyé au pair quand l'autre côté se connecte/déconnecte.
// Prépare le terrain pour le chiffrement E2E futur : ces messages système
// restent en clair, seule la charge utile des messages métier sera chiffrée.
interface SystemMessage {
  type: 'PEER_CONNECTED' | 'PEER_DISCONNECTED'
  role: Role
}

const PEER: Record<Role, Role> = { hub: 'satellite', satellite: 'hub' }

function send(ws: WebSocket, msg: SystemMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg))
  }
}

export class RoomManager {
  private rooms = new Map<string, Room>()

  private getOrCreate(token: string): Room {
    let room = this.rooms.get(token)
    if (!room) {
      room = { hub: null, satellite: null }
      this.rooms.set(token, room)
    }
    return room
  }

  /** Ajoute un client dans la room, notifie le pair si déjà présent. */
  join(token: string, role: Role, ws: WebSocket): void {
    const room = this.getOrCreate(token)
    room[role] = ws

    const peer = room[PEER[role]]
    if (peer !== null) {
      // Les deux côtés sont maintenant connectés
      send(peer, { type: 'PEER_CONNECTED', role })
      send(ws,   { type: 'PEER_CONNECTED', role: PEER[role] })
    }
  }

  /** Retire un client, notifie le pair et nettoie la room si vide. */
  leave(token: string, role: Role): void {
    const room = this.rooms.get(token)
    if (!room) return

    room[role] = null

    const peer = room[PEER[role]]
    if (peer !== null) {
      send(peer, { type: 'PEER_DISCONNECTED', role })
    }

    if (room.hub === null && room.satellite === null) {
      this.rooms.delete(token)
    }
  }

  /** Retransmet un message brut vers le pair sans inspecter le contenu. */
  relay(token: string, fromRole: Role, data: RawData): void {
    const room = this.rooms.get(token)
    if (!room) return

    const peer = room[PEER[fromRole]]
    if (peer === null || peer.readyState !== WebSocket.OPEN) return

    // Normalise Buffer[] → Buffer pour un send uniforme
    const payload = Array.isArray(data) ? Buffer.concat(data) : data
    peer.send(payload)
  }

  get roomCount(): number {
    return this.rooms.size
  }
}
