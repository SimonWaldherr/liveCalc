const fs = require('fs');
const postcss = require('postcss');
// Use the PostCSS wrapper for Tailwind (package @tailwindcss/postcss)
const tailwind = require('@tailwindcss/postcss');
const autoprefixer = require('autoprefixer');

const input = './src/input.css';
const output = './tailwind.css';
const content = ['./**/*.html', './**/*.js'];

async function build() {
  try {
    const css = fs.readFileSync(input, 'utf8');
    const result = await postcss([tailwind({ content }), autoprefixer]).process(css, { from: input });
    fs.writeFileSync(output, result.css, 'utf8');
    console.log('Wrote', output);
  } catch (err) {
    console.error('Build failed:', err);
    process.exit(1);
  }
}

build();
