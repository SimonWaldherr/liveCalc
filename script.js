document.addEventListener('DOMContentLoaded', function() {
  initializeApp();
}, false);

function initializeApp() {
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
}

function utf8_to_b64(str) {
  return window.btoa(unescape(encodeURIComponent(str)));
}

function b64_to_utf8(str) {
  return decodeURIComponent(escape(window.atob(str)));
}

function evalMath() {
  const parser = math.parser();
  let output = '';
  let input = [];
  let formulas = $('#frame1').val();

  if (formulas.includes(",") && !formulas.includes(".")) {
    formulas = formulas.replace(/(\d+),(\d+)/gi, "$1.$2");
  }

  const arrayOfLines = formulas.split('\n');
  let globalSum = math.bignumber(0);
  let localSum = math.bignumber(0);
  let units = null;
  const maxLen = Math.max(...arrayOfLines.map(item => item.length));

  arrayOfLines.forEach(item => {
    if (containsSumKeyword(item)) {
      if (localSum.isZero() && globalSum.isZero()) {
        output += `${item} = 0\n`;
      } else {
        const displaySum = units ? globalSum.toString() + units : globalSum.toString();
        output += `${item} = ${displaySum}\n`;
        localSum = math.bignumber(0); // Reset local sum after each Summe keyword
      }
    } else {
      try {
        parser.evaluate(item);
      } catch (err) {
        output += `${item} = ${err}\n`;
        return;
      }

      input.push(item);
      const evaluationResult = evaluateItem(parser, input, item, maxLen);
      output += evaluationResult;

      const lastResult = getLastResult(parser, input);
      if (lastResult) {
        try {
          const { updatedSum, updatedUnits } = updateSum(localSum, globalSum, lastResult, units);
          localSum = updatedSum.localSum;
          globalSum = updatedSum.globalSum;
          units = updatedUnits || units;
        } catch (err) {
          output += `${item} = ${err.message}\n`;
          return;
        }
      }
    }
  });

  $("#highlights1").html(output);
}

function containsSumKeyword(item) {
  const keywords = ['total', 'sum', 'summe', 'gesamt'];
  return keywords.some(keyword => item.toLowerCase().includes(keyword));
}

function getLastResult(parser, input) {
  const result = parser.evaluate(input);
  if (result && result.length > 0) {
    return result[result.length - 1];
  }
  return null;
}

function updateSum(localSum, globalSum, lastResult, units) {
  if (math.typeOf(lastResult) === 'Unit') {
    const unitName = lastResult.units[0].unit.name;
    const lastResultValue = lastResult.toNumber(unitName);

    if (!units || units === unitName) {
      return {
        updatedSum: {
          localSum: localSum.add(lastResultValue),
          globalSum: globalSum.add(lastResultValue),
        },
        updatedUnits: unitName
      };
    } else {
      throw new Error('Units do not match');
    }
  } else if (typeof lastResult === 'number' || math.typeOf(lastResult) === 'BigNumber') {
    return {
      updatedSum: {
        localSum: localSum.add(lastResult),
        globalSum: globalSum.add(lastResult),
      },
      updatedUnits: units
    };
  }
  return { updatedSum: { localSum, globalSum }, updatedUnits: units };
}

function evaluateItem(parser, input, item, maxLen) {
  if (parser.evaluate(input) === undefined || item.trim() === '') {
    return `${item}\n`;
  } else {
    const ev_raw = parser.evaluate(input).slice(-1);
    const ev_str = JSON.stringify(ev_raw);
    if (ev_raw !== undefined && ev_str !== "[null]") {
      const spacing = ' '.repeat(maxLen - item.length);
      return `${item}${spacing} = ${ev_raw}\n`;
    } else {
      return `${item}\n`;
    }
  }
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
