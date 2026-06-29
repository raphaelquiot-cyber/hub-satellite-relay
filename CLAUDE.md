# CLAUDE.md — Relay WebSocket

> Dernière mise à jour : 2026-06-29
> Statut : ✅ Opérationnel en localhost — déploiement VPS Hostinger à venir

---

## Rôle

Serveur Node.js + TypeScript minimal qui sert de **tuyau** entre le Hub (macOS) et le Satellite (iOS). Il permet au Satellite d'accéder au Hub depuis n'importe où sur Internet, sans exposer le Mac directement.

**Principe fondamental :** le relais ne stocke rien, n'inspecte rien, ne transforme rien. Il reçoit un message d'un côté et le retransmet à l'autre. Si le relais tombe, le mode LAN local continue de fonctionner (le relais s'ajoute, ne remplace pas).

---

## Architecture

```
relay/
├── CLAUDE.md                 ← Ce fichier
├── .env.example              ← Variables d'environnement
├── package.json
├── tsconfig.json
└── src/
    ├── server.ts             — serveur HTTP + WebSocket, gestion des connexions
    ├── RoomManager.ts        — associe Hub et Satellite dans une même "room"
    └── TokenValidator.ts     — vérifie les tokens de connexion (placeholder HMAC)
```

---

## Fonctionnement

```
Hub ──wss──▶ Relay ◀──wss── Satellite
              │
              └── RoomManager : room[token] = { hub: ws, satellite: ws }
                  Tout message entrant d'un côté est retransmis à l'autre.
```

1. Le Hub se connecte : `ws://localhost:4000?token=TOKEN&role=hub`
2. Le Satellite se connecte : `ws://localhost:4000?token=TOKEN&role=satellite`
3. Le RoomManager les associe dans la même room (même `token`)
4. Tout message du Hub est retransmis au Satellite, et vice-versa
5. Si un côté se déconnecte, l'autre reçoit un message système `PEER_DISCONNECTED`

### Messages système (JSON, envoyés par le relais lui-même)

```json
{ "type": "PEER_CONNECTED",    "role": "hub" }
{ "type": "PEER_DISCONNECTED", "role": "satellite" }
```

Ces messages sont injectés par le relais — ils ne proviennent pas du pair. Le Hub et le Satellite doivent les gérer pour afficher l'état de connexion.

---

## Tokens

Un token identifie une room (un utilisateur). Format attendu : string alphanumérique ≥ 32 caractères.

**Générer un token :**
```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
# → ex: a3f8e21c9b047d6e83a1f92c7d450be1c3e7a2b9f0d1e4c
```

Le même token est configuré côté Hub (dans les Paramètres → Relais) et côté Satellite (dans Paramètres → IP Hub). Les deux doivent utiliser le même token pour être mis en relation.

---

## Sécurité

### Aujourd'hui (localhost)
- Token ≥ 32 caractères, alphanumérique (`TokenValidator.isValid()`)
- Les connexions/déconnexions sont loggées (role + 8 premiers chars du token + IP)
- **Le contenu des messages n'est jamais loggé ni inspecté**

### En production (VPS)
- TLS via nginx reverse proxy (`wss://`) — le relais écoute en `ws://` derrière nginx
- Token HMAC-SHA256 signé avec un secret partagé (remplacer `TokenValidator.isValid()`)
- Rate-limiting nginx sur les nouvelles connexions

### Futur — chiffrement end-to-end (E2E)
La structure est prête. Le relais ne voit que des `Buffer` opaques. Pour activer le E2E :
- Hub chiffre les messages avec la clé publique du Satellite (ou une clé symétrique partagée hors-bande)
- Le relais retransmet les `Buffer` sans les décoder (déjà le cas aujourd'hui)
- Satellite déchiffre à la réception
- **Aucune modification du relais nécessaire** — il est déjà opaque par conception

---

## Démarrage

```bash
cd relay

# Installer les dépendances
npm install

# Mode développement (ts-node, pas de build)
npm run dev

# Mode production
npm run build && npm start
```

**Health-check :** `GET http://localhost:4000` → `{ "status": "ok", "rooms": N, "timestamp": "..." }`

---

## Variables d'environnement

| Variable | Défaut | Description |
|---|---|---|
| `PORT` | `4000` | Port d'écoute WebSocket et HTTP |

Copier `.env.example` → `.env` et ajuster si nécessaire.

---

## Déploiement VPS Hostinger (à venir)

1. Provisionner un VPS Hostinger (Ubuntu 22.04, 1 vCPU, 2 Go RAM suffisent)
2. Installer Node.js 22 LTS + nginx
3. Cloner ce dossier sur le VPS, `npm install && npm run build`
4. Configurer nginx : reverse proxy `wss://relay.votre-domaine.fr` → `ws://localhost:4000`
5. Certificat TLS Let's Encrypt via Certbot
6. Systemd service pour auto-restart
7. Mettre à jour la config Hub et Satellite pour pointer sur `wss://relay.votre-domaine.fr`

---

## Intégration Hub et Satellite (prochaine étape)

### Hub (`hub-app`)
- Paramètre `relay_url` + `relay_token` dans la page Paramètres (stocké en DB `settings`)
- `WebSocketRelayClient.ts` : se connecte au relais en plus du mode LAN
- Si le relais est configuré, utiliser `relay_url`; sinon fallback sur l'IP LAN

### Satellite (`satellite-app`)
- Page Paramètres : champ "URL du relais" (ex: `wss://relay.mondomaine.fr`)
- `WebSocketClient.ts` : utiliser l'URL du relais si pas de connexion LAN directe
- Afficher l'état de connexion (LAN direct vs relais distant)
