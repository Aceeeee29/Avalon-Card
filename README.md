# Avalon Vote

Realtime voting board. Players join a room from their own phones; the number of voters is whoever is in the room when the host starts the vote.

## Run

Open the folder through a web server (ES modules don't load from `file://`):

```
python -m http.server 5173
```

then visit `http://localhost:5173`. With no Firebase config the app runs in **demo mode** (rooms sync between tabs on the same device only; add `?p=2`, `?p=3` to the URL to act as different players in one browser).

## Enable real multi-device play (Firebase)

1. https://console.firebase.google.com -> **Add project**.
2. **Build -> Realtime Database -> Create database** (start in test mode).
3. **Project settings -> Your apps -> Web (`</>`)** -> copy the config object.
4. Paste it into `firebase-config.js` (`export default { ... }`, including `databaseURL`).
5. Paste `database.rules.json` into the database's **Rules** tab.
6. Host the folder somewhere phones can reach it (Firebase Hosting: `firebase init hosting` then `firebase deploy`, or GitHub Pages / Netlify).

## How a game works

- **Host** creates a room and shares the 4-letter code or invite link.
- **Players** just enter the code. There are no names: players appear as Player 1, Player 2, ... in join order. The lobby updates live.
- Host presses **Start vote**: the roster is locked in. Voting is one vote per player.
- **New round** clears votes and re-reads the player list (late joiners get in). **Lobby** returns to the lobby. **End room** closes it for everyone.
- Votes are always secret: the tally and result stay hidden until everyone has voted.
- Rules: APPROVED if Approve > Reject; REJECTED if Reject >= Approve once all votes are in.

## Data layout

```
rooms/{code}
  host, phase ('lobby'|'voting'), round
  players/{pid}  { name, joinedAt, online }
  roster/{pid}   name          (snapshot taken when the round starts)
  votes/{pid}    'approve' | 'reject'
```

The rules in `database.rules.json` are intentionally open (no sign-in) and only accept the expected shapes, which suits a game night. Don't store anything private in this database.
