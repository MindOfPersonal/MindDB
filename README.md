# MindDB

Modern, lokaal MariaDB-beheerpanel in Node.js — een lichtgewicht alternatief voor phpMyAdmin, met een donkere, snelle webinterface.

## Starten

```bash
npm install
npm start
```

Open daarna **http://localhost:3005** in je browser. Maak bij het eerste gebruik een account aan; de **eerste gebruiker wordt beheerder**.

Ontwikkelmodus (herstart bij wijzigingen):

```bash
npm run dev
```

Poort, host en overige instellingen aanpassen via een `.env`-bestand (zie `.env.example`) of environment-variabelen:

```bash
$env:PORT=8080; npm start        # PowerShell
PORT=8080 npm start              # bash
```

## Functies

### Accounts & authenticatie
- **Registreren en inloggen** met gebruikersnaam of e-mail; wachtwoorden gehasht met scrypt
- Accounts en sessies worden opgeslagen in MariaDB (database `PANEL_DB`, standaard `minddb_panel`)
- Eerste account wordt beheerder; beheerders kunnen rollen wijzigen en accounts verwijderen
- Sessies blijven bewaard na een herstart van de server (DB-sessie-store)
- Registratie uitschakelen met `ALLOW_REGISTRATION=false`

### Verbindingen
- Verbind met elke MariaDB/MySQL-server (host, poort, gebruiker, wachtwoord, optionele database)
- **Profielen**: sla verbindingen op (wachtwoorden AES-256-GCM-versleuteld in `data/profiles.json`)
- Verbinding testen vóór het verbinden

### Databases & tabellen
- Boom met databases, tabellen, views, procedures, functies, triggers en events
- **Database-overzicht** in het hoofdscherm (klik op een database): metrics, objectenlijst met rijen/grootte/engine en directe acties
- Databases aanmaken (met charset/collatie) en verwijderen
- **Rechten op databaseniveau**: per gebruiker GRANT/REVOKE beheren (via rechtsklik op een database), en optioneel direct rechten toekennen bij het aanmaken van een database
- Tabellen aanmaken (visuele kolombouwer), hernoemen, dupliceren, legen (TRUNCATE) en verwijderen
- CREATE-statements bekijken en kopiëren

### Data-browser
- Snelle datagrid met paginering, sorteren op kolom en WHERE-filter
- **Inline bewerken** (dubbelklik op een cel), wijzigingen in één keer opslaan
- Rijen toevoegen via formulier, rijen (bulk) verwijderen

### Structuur
- Kolommen bekijken/toevoegen/wijzigen/verwijderen (type, NULL, default, AUTO_INCREMENT, PK)
- Indexen beheren (incl. UNIQUE), foreign keys overzicht, DDL-weergave

### SQL-editor
- CodeMirror-editor met MariaDB-syntax highlighting en autocomplete
- Meerdere statements, gedeeltelijke selectie uitvoeren (`Ctrl+Enter`)
- Resultaatsets in tabs, CSV kopiëren, query-historie (lokaal opgeslagen)

### Serverbeheer
- Dashboard: uptime, verbindingen, queries/s, trage queries, InnoDB buffer pool, databasegroottes
- Processlijst met auto-refresh en KILL
- Servervariabelen (GLOBAL/SESSION) met zoekfunctie
- Gebruikersbeheer: aanmaken met rechten, grants bekijken, verwijderen
- Per gebruiker database-rechten bekijken, toekennen en intrekken

### Export & import
- SQL-dump van hele databases of tabellen (structuur + data)
- Tabel exporteren als CSV of JSON
- SQL-bestanden importeren (tot 200 MB)

## Structuur

```
├── server.js            # Express-entry, sessies, statische hosting, foutafhandeling
├── src/
│   ├── auth.js          # Paneelaccounts + sessies in MariaDB (scrypt)
│   ├── db.js            # Connection pools per sessie + versleutelde profielen
│   └── routes/
│       ├── api.js       # Complete REST-API (databases, tabellen, SQL, server, ...)
│       └── auth.js      # Authenticatie- en beheer-routes
├── public/              # Frontend (vanilla JS ES-modules, geen build-stap)
│   ├── index.html
│   ├── css/style.css
│   └── js/              # app, auth, login, sidebar, database, browse, structure, sql, dashboard, privileges, actions, tabs, api, util
└── data/                # Runtime: profielen + secrets (niet in git)
```

## Beveiliging

- Luistert standaard alleen op `127.0.0.1` (lokaal); zet `HOST=0.0.0.0` voor externe toegang
- Paneelaccounts worden met **scrypt** gehasht en in MariaDB opgeslagen; alle `/api`-routes (behalve auth) vereisen een ingelogde gebruiker
- Wachtwoorden van profielen worden versleuteld opgeslagen met een lokaal gegenereerde sleutel (`data/.secret`)
- Alle SQL-identifiers worden ge-escaped; waardes gaan via prepared statements
