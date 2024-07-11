document.addEventListener('DOMContentLoaded', function() {
  const hashvalue = window.location.hash.substring(1);
  if (hashvalue.length > 4) {
    $('#frame1').val(b64_to_utf8(hashvalue));
  }
  evalMath();
  
  $('#frame1').on('keyup change', function() {
    evalMath();
    const encodedMath = utf8_to_b64($('#frame1').val());
    window.location.hash = encodedMath;
  });

  $('.linked').scroll(function() {
    $('.bed-highlights').css('transform', `translateY(${-this.scrollTop}px)`);
  });
}, false);

function utf8_to_b64(str) {
  return window.btoa(unescape(encodeURIComponent(str)));
}

function b64_to_utf8(str) {
  return decodeURIComponent(escape(window.atob(str)));
}

function evalMath() {
  const parser = math.parser();
  let output = '';
  const input = [];
  let formulas = $('#frame1').val();

  if (formulas.includes(",") && !formulas.includes(".")) {
    formulas = formulas.replace(/(\d+),(\d+)/gi, "$1.$2");
  }

  const arrayOfLines = formulas.split('\n');
  let sum = math.bignumber(0);
  let units = null;
  let maxLen = 0;
  
  $.each(arrayOfLines, function(index, item) {
    if (item.length > maxLen) {
      maxLen = item.length;
    }
  });

  $.each(arrayOfLines, function(index, item) {
    try {
      parser.evaluate(item);
    } catch (err) {
      output += `${item} = ${err}\n`;
      return;
    }

    input.push(item);

    const trimmedItem = item.trim();
    if (trimmedItem.toLowerCase().includes('total') || trimmedItem.toLowerCase().includes('sum') || trimmedItem.toLowerCase().includes('summe') || trimmedItem.toLowerCase().includes('gesamt')) {
      try {
        const result = parser.evaluate(input);
        if (result && result.length > 0) {
          const lastResult = result[result.length - 1];
          if (math.typeOf(lastResult) === 'Unit') {
            if (!units) {
              units = lastResult.units[0].unit.name;
            }
            if (units === lastResult.units[0].unit.name) {
              sum = math.add(sum, lastResult);
            } else {
              throw new Error('Units do not match');
            }
          } else if (typeof lastResult === 'number') {
            sum = math.add(sum, lastResult);
          }
        }
      } catch (err) {
        output += `${item} = ${err.message}\n`;
        return;
      }
    }

    if (parser.evaluate(input) === undefined || item.trim() === '') {
      output += `${item}\n`;
    } else {
      const ev_raw = parser.evaluate(input).slice(-1);
      const ev_str = JSON.stringify(parser.evaluate(input).slice(-1));
      if (ev_raw !== undefined && ev_str !== "[null]") {
        let spacing = ' '.repeat(maxLen - item.length)
        output += `${item} ${spacing}= ${ev_raw}\n`;
      } else {
        output += `${item}\n`;
      }
    }
  });

  if (sum != 0) {
    output += `\nTotal Sum = ${sum}\n`;
  }

  $("#highlights1").html(output);
}

function clearTextarea() {
  $('#frame1').val('');
  evalMath();
}

function insertExample() {
  $('#frame1').val(b64_to_utf8('QSA9ICgxLjIgLyAoMy4zICsgMS43KSkgY20KQiA9IDUuMDggY20gKyAyLjUgaW5jaApDID0gQiAqIEIgKiBBIGluIGNtMwoKCg=='));
  evalMath();
}

function download(filename, text) {
  const element = document.createElement('a');
  element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
  element.setAttribute('download', filename);

  element.style.display = 'none';
  document.body.appendChild(element);

  element.click();

  document.body.removeChild(element);
}

function downloadMath() {
  const filename = window.prompt('Save calculation as:', 'liveCalc.txt');
  const content = $("#highlights1").text().replace(/ +/g, " ");
  download(filename, content);
  return false;
}

function copyURLtoClipboard() {
  navigator.clipboard.writeText(window.location.href);
}
