# CLAUDE.md — Relay WebSocket

> Dernière mise à jour : 2026-06-30
> Statut : ✅ Déployé en production — wss://relay.raphael-hub.cloud — testé en 4G/5G

---

## Rôle

Serveur Node.js + TypeScript minimal qui sert de **tuyau** entre le Hub (macOS) et le Satellite (iOS). Il permet au Satellite d'accéder au Hub depuis n'importe où sur Internet, sans exposer le Mac directement.

**Principe fondamental :** le relais ne stocke rien, n'inspecte rien, ne transforme rien. Il reçoit un message d'un côté et le retransmet à l'autre. Si le relais tombe, le mode LAN local continue de fonctionner (le relais s'ajoute, ne remplace pas).

---

## Infrastructure de production

| Paramètre | Valeur |
|---|---|
| URL | `wss://relay.raphael-hub.cloud` |
| VPS | Hostinger (IP 76.13.59.228) |
| Déploiement | EasyPanel (Docker natif) |
| TLS | Caddy (Let's Encrypt, auto-renouvelé) |
| Port interne | 4000 (ENV PORT=4000 dans Dockerfile) |
| Port Caddy | 443 (wss:// → ws://localhost:4000) |
| Repo GitHub | https://github.com/raphaelquiot-cyber/hub-satellite-relay |
| Redémarrage | `restart: always` (docker-compose) |

**Important EasyPanel :** régler "App Port" à `4000` dans les settings du projet. EasyPanel injecte `PORT=<App Port>` au runtime — si non défini, il injecte `PORT=80` ce qui casse le HEALTHCHECK.

---

## Architecture

```
relay/
├── CLAUDE.md                 ← Ce fichier
├── Dockerfile                — multi-stage build (node:20-alpine), ENV PORT=4000
├── docker-compose.yml        — restart: always, PORT=4000, MIN_TOKEN_LENGTH=32
├── .dockerignore
├── .env.example              ← Variables d'environnement
├── package.json
├── tsconfig.json
└── src/
    ├── server.ts             — serveur HTTP + WebSocket, gestion des connexions
    ├── RoomManager.ts        — associe Hub et Satellite dans une même "room"
    └── TokenValidator.ts     — vérifie les tokens (format alphanumérique ≥ 32 chars)
```

---

## Fonctionnement

```
Hub ──wss──▶ wss://relay.raphael-hub.cloud ◀──wss── Satellite
              (Caddy TLS → ws://localhost:4000)
                         │
                         └── RoomManager : room[token] = { hub: ws, satellite: ws }
                             Tout message entrant d'un côté est retransmis à l'autre.
```

1. Le Hub se connecte : `wss://relay.raphael-hub.cloud?token=TOKEN&role=hub`
2. Le Satellite se connecte : `wss://relay.raphael-hub.cloud?token=TOKEN&role=satellite`
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

**Générer un token (depuis Hub → Paramètres → Accès distant) :**
```bash
# Ou en ligne de commande :
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
# → ex: a3f8e21c9b047d6e83a1f92c7d450be1c3e7a2b9f0d1e4c
```

Le même token est configuré côté Hub (DB `settings` → `relay_token`) et côté Satellite (AsyncStorage). Ils doivent être identiques pour être mis en relation.

---

## Sécurité

### En production (état actuel)
- TLS via Caddy en reverse proxy (`wss://`) — le relais écoute en `ws://` derrière Caddy
- Token ≥ 32 caractères, alphanumérique (`TokenValidator.isValid()`)
- Connexions/déconnexions loggées (role + 8 premiers chars du token + IP)
- **Le contenu des messages n'est jamais loggé ni inspecté**
- Close code 1008 si token invalide ou rôle inconnu

### Futur — chiffrement end-to-end (E2E)
La structure est prête. Le relais ne voit que des `Buffer` opaques. Pour activer le E2E :
- Hub chiffre les messages avec une clé symétrique partagée hors-bande
- Le relais retransmet les `Buffer` sans les décoder (déjà le cas aujourd'hui)
- Satellite déchiffre à la réception
- **Aucune modification du relais nécessaire** — il est déjà opaque par conception

### Futur — token HMAC-SHA256
`TokenValidator.isValid()` est un placeholder. Remplacer par un HMAC-SHA256 signé avec un secret partagé entre Hub et relais pour empêcher des tiers de créer des rooms.

---

## Déploiement et redéploiement

```bash
# Build local (vérification avant push)
cd relay
npm run build

# Push vers GitHub (déclenche le redéploiement EasyPanel)
git add -A && git commit -m "fix/feat: ..." && git push origin main

# Sur EasyPanel : déclencher manuellement le redeploy depuis GitHub
# → Logs disponibles dans EasyPanel → relay → Logs
```

**HEALTHCHECK (Dockerfile) :**
```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-4000}/ | grep -q '"status":"ok"' || exit 1
```
Le `${PORT:-4000}` est essentiel — sans ça, si EasyPanel injecte PORT=80, le healthcheck sonde le mauvais port et redémarre le container en boucle.

---

## Démarrage local (développement)

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
| `PORT` | `4000` | Port d'écoute WebSocket et HTTP (injecté par EasyPanel en production) |
| `MIN_TOKEN_LENGTH` | `32` | Longueur minimale des tokens acceptés |

---

## Intégration Hub et Satellite — état actuel

### Hub (`hub-app`)
- `RelayClient.ts` — singleton, connexion avec token et role=hub, backoff exponentiel (10 tentatives max)
- Settings DB : `relay_enabled`, `relay_url`, `relay_token`
- Page Paramètres → "Accès distant" : toggle, URL, génération token, statut en temps réel
- Broadcast EventBus → relais vers Satellite (mêmes events que le WS LAN)
- Reconnexion OAuth (invalid_grant) : bannière Dashboard + bouton "Reconnecter"

### Satellite (`satellite-app`)
- `HubConnection.ts` — mode LAN/relais, `loadConnectionSettings()` chargé avant connect()
- `WebSocketClient.ts` — utilise `getActiveWsUrl()` à chaque tentative (mode peut changer)
- Page Paramètres (5e onglet) : bascule Local/Relais, IP Hub, URL relais, token, statut Hub polling
