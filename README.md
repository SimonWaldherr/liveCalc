# liveCalc

[![mathjs](https://img.shields.io/badge/powered%20by-mathjs-blue.svg)](https://mathjs.org/) 
[![github](https://img.shields.io/badge/hosted%20on-github-yellow.svg)](https://github.com/SimonWaldherr/liveCalc) 
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://github.com/SimonWaldherr/liveCalc/blob/main/LICENSE)  


[![SimonWaldherr/liveCalc Online Calculator](https://simonwaldherr.github.io/liveCalc/screenshot.png)](https://simonwaldherr.github.io/liveCalc/)  

With liveCalc, formulas can be calculated in real time.  
The calculation is updated with each keystroke.  
Variables can be used. Conversions, e.g. from cm to inch, are also possible.  
The calculations can also be easily shared with colleagues, just pass the web address and the calculation will be pasted.

* [empty](https://simonwaldherr.github.io/liveCalc/)
* [example 1 - calculation of distances](https://simonwaldherr.github.io/liveCalc/#YSA9IDNjbQpiID0gNGluY2gKYyA9IDAuMDNtCgphK2IrYyBpbiBtbQ==)
* [example 2 - calculation of volume](https://simonwaldherr.github.io/liveCalc/#QSA9ICgxLjIgLyAoMy4zICsgMS43KSkgY20KQiA9IDUuMDggY20gKyAyLjUgaW5jaApDID0gQiAqIEIgKiBBIGluIGNtMwoKCg==)
* [example 3 - calculation of surface](https://simonwaldherr.github.io/liveCalc/#YSA9IDNjbQpiID0gNGNtCmMgPSAyLjVjbQoKc3VyZmFjZSA9IDIqKGEqYythKmIrYipjKSBpbiBjbV4yCgpzdXJmYWNlIGluIGluY2heMg==)
* [example 4 - calculation of weights](https://simonwaldherr.github.io/liveCalc/#d2VpZ2h0ID0gNCBsYiBpbiBrZwp3ZWlnaHQgaW4gbGIK)
* [example 5 - matrix](https://simonwaldherr.github.io/liveCalc/#YSA9IFsxOyAyOyAzOyAyKzI7IDU7IDZdCmEqMi41)
* [example 6 - binary/oct/hex](https://simonwaldherr.github.io/liveCalc/#CkEgPSAwYjAxMTAxCkIgPSAwbzEyMzQKQyA9IDB4YmVlZgoKaGV4KEErQitDKQpvY3QoQStCK0MpCmJpbihBK0IrQykK)


## International use & localization

liveCalc is designed to be friendly for international users:

* **Multilingual UI** — English and German are bundled. The language is auto-detected from your browser on first visit and can be changed any time in **Settings → Appearance → Language**. Switching language is instant; no reload required.
* **Decimal separator** — pick **`.`** (1.23) or **`,`** (1,23) for results. Defaults follow your locale (German → `,`).
* **Thousands separator** — choose between *none*, *space* (1 234 567), *comma* (1,234,567), *dot* (1.234.567), or *apostrophe* (1'234'567). Defaults follow your locale.
* **Unit system** — choose between **Metric / SI** (m, kg, l, °C — default), **Imperial / US** (ft, lb, gal, °F), or **Both**. The setting also tells the AI assistant which units to prefer when suggesting expressions.
* **CSV delimiter** — for imported tables, pick auto-detect, comma, semicolon, tab, or pipe — useful in regions where `;` is the default CSV separator.

The math engine itself always uses `.` internally (math.js requirement); only the *displayed* output and AI suggestions are localized.

## AI assistant integration

liveCalc ships with an optional AI assistant panel (OpenAI-compatible). It is fully integrated with the localization settings:

* The system prompt automatically tells the model **which language to reply in**, **which unit system to prefer**, and **which decimal separator** the user reads — so SI units and the user's language are used naturally.
* Connection / network errors and panel UI are localized.
* Configure provider, base URL, model, and API key under **Settings → AI / LLM**. Local OpenAI-compatible servers (LM Studio, Ollama with the OpenAI shim, llama.cpp server, etc.) are supported out of the box.
* Snippets emitted by the AI between `LIVECALC_INSERT_START` / `LIVECALC_INSERT_END` markers can be inserted into the editor with a single click.

---

## Internationale Nutzung (Deutsch)

liveCalc ist von Grund auf für die internationale Nutzung konzipiert:

* **Mehrsprachige Oberfläche** – Englisch und Deutsch sind integriert. Die Sprache wird beim ersten Aufruf automatisch aus dem Browser erkannt und lässt sich jederzeit unter **Einstellungen → Darstellung → Sprache** umschalten – ohne Neuladen der Seite.
* **Dezimaltrennzeichen** – Punkt oder Komma frei wählbar (Voreinstellung folgt der Sprache, z. B. Deutsch → Komma).
* **Tausendertrennzeichen** – keins, Leerzeichen, Komma, Punkt oder Apostroph.
* **Einheitensystem** – metrisch / SI (Vorgabe), imperial / US oder beide. Diese Auswahl wirkt sich auch auf Vorschläge der KI aus.
* **CSV-Trennzeichen** – beim Datenimport wählbar (Auto, Komma, Semikolon, Tabulator, Pipe).
* **KI-Integration** – die KI antwortet in der gewählten UI-Sprache und bevorzugt das gewählte Einheitensystem. Fehlermeldungen sind lokalisiert.

Intern rechnet liveCalc immer mit `.` als Dezimaltrennzeichen (math.js-Vorgabe); nur die **Anzeige** und die KI-Vorschläge folgen den persönlichen Einstellungen.





