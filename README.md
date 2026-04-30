# LiveCalc Pro

[![mathjs](https://img.shields.io/badge/powered%20by-mathjs-blue.svg)](https://mathjs.org/)
[![github](https://img.shields.io/badge/hosted%20on-github-yellow.svg)](https://github.com/SimonWaldherr/liveCalc)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://github.com/SimonWaldherr/liveCalc/blob/main/LICENSE)

[![LiveCalc Pro — Interactive Math Studio](https://simonwaldherr.github.io/liveCalc/screenshot.png)](https://simonwaldherr.github.io/liveCalc/)

**LiveCalc Pro** is a browser-based interactive math notebook.  
Formulas are evaluated in real time — the result updates with every keystroke.  
No installation, no account, no server: everything runs locally in your browser.

➡️ **[Open LiveCalc Pro](https://simonwaldherr.github.io/liveCalc/)**

---

## Run locally

LiveCalc is a static web app. You can run it locally with any simple HTTP server:

```bash
cd path/to/liveCalc
python3 -m http.server 8080
```

Then open: `http://localhost:8080`

> Note: some browser setups block `file://` features, so serving over HTTP is recommended.

---

## Features

### Real-time calculation
Every line is evaluated as you type using [math.js](https://mathjs.org/).  
Results appear inline next to each expression.

### Variables
Assign values to named variables and reuse them across lines:
```
radius = 5 cm
area = pi * radius^2 in cm^2
```

### Unit conversions
Convert between a wide range of units in a single expression:
```
a = 3 cm
b = 4 inch
a + b in mm
```

Supported unit families include:

| Category | Examples |
|---|---|
| Length | `mm`, `cm`, `m`, `km`, `in`, `ft`, `yd`, `mi` |
| Mass | `mg`, `g`, `kg`, `t`, `oz`, `lb`, `slug` |
| Volume | `ml`, `l`, `L`, `gal`, `gallon`, `ft3`, `in3` |
| Area | `cm2`, `m2`, `in2`, `ft2` (also `^2` notation) |
| Time | `s`, `sec`, `min`, `h` |
| Pressure | `Pa`, `bar`, `atm`, `psi` |
| Force | `N`, `lbf` |
| Currency | `USD`, `EUR`, `GBP`, `JPY`, `CHF`, `AUD`, `CAD` |
| Misc | `percent` |

### Function plotting
Define a function of `x` to get an interactive graph in the sidebar:
```
f(x) = x^2 - 2*x + 1
```
Multiple functions (`f(x)`, `g(x)`, …) are plotted simultaneously.

### Data import
Upload a **CSV, TSV, JSON, or XML** file to load it as a named dataset.  
Query the dataset directly from the notebook:
```
avg(sales[region == "North"])
```

### AI / LLM chat assistant
Connect to an LLM to get help with calculations, explanations, or formula suggestions.  
Supported providers (configured in **Settings**):

| Provider | Notes |
|---|---|
| **OpenAI** | Requires API key; default model `gpt-4.1-mini` |
| **Local** | OpenAI-compatible server (e.g. Ollama, LM Studio) at `localhost:1234` |
| **Custom** | Any OpenAI-compatible endpoint |

The assistant is aware of the current notebook content and can suggest snippets that are inserted into the editor with one click.

### Shareable URLs
The notebook content is encoded in the URL hash.  
Copy the link and share it — recipients open the same calculation instantly.

### Download
Save the current notebook as a plain-text file with the **Download** button.

### Dark mode
Toggle between light and dark themes using the moon icon in the toolbar.

### Built-in examples
The **Examples** menu provides ready-to-run snippets for common scenarios:
geometry, finance (compound interest), mixed-unit sums, matrix operations, CSV table queries, and data plots.

---

## Examples

| Link | Description |
|---|---|
| [Open empty](https://simonwaldherr.github.io/liveCalc/) | Blank notebook |
| [Distances](https://simonwaldherr.github.io/liveCalc/#YSA9IDNjbQpiID0gNGluY2gKYyA9IDAuMDNtCgphK2IrYyBpbiBtbQ==) | Add lengths in different units |
| [Volume](https://simonwaldherr.github.io/liveCalc/#QSA9ICgxLjIgLyAoMy4zICsgMS43KSkgY20KQiA9IDUuMDggY20gKyAyLjUgaW5jaApDID0gQiAqIEIgKiBBIGluIGNtMwoKCg==) | Compute a box volume |
| [Surface area](https://simonwaldherr.github.io/liveCalc/#YSA9IDNjbQpiID0gNGNtCmMgPSAyLjVjbQoKc3VyZmFjZSA9IDIqKGEqYythKmIrYipjKSBpbiBjbV4yCgpzdXJmYWNlIGluIGluY2heMg==) | Box surface in cm² and in² |
| [Weights](https://simonwaldherr.github.io/liveCalc/#d2VpZ2h0ID0gNCBsYiBpbiBrZwp3ZWlnaHQgaW4gbGIK) | Convert between lb and kg |
| [Matrix](https://simonwaldherr.github.io/liveCalc/#YSA9IFsxOyAyOyAzOyAyKzI7IDU7IDZdCmEqMi41) | Vector / matrix arithmetic |
| [Binary / Octal / Hex](https://simonwaldherr.github.io/liveCalc/#CkEgPSAwYjAxMTAxCkIgPSAwbzEyMzQKQyA9IDB4YmVlZgoKaGV4KEErQitDKQpvY3QoQStCK0MpCmJpbihBK0IrQykK) | Number base conversions |

---

## Technology

| Library | Purpose |
|---|---|
| [math.js](https://mathjs.org/) v15 | Expression parsing and evaluation |
| [function-plot](https://mauriciopoppe.github.io/function-plot/) | Interactive function graphs |
| [KaTeX](https://katex.org/) | Math rendering in the AI chat |
| [Tailwind CSS](https://tailwindcss.com/) | UI styling |

---

## Notes

- LLM API keys and settings are stored in your browser local storage.
- Local provider mode expects an OpenAI-compatible endpoint (default: `http://localhost:1234/v1`).
- Shared links include encoded notebook content in the URL hash.

---

## License

[MIT](LICENSE)
