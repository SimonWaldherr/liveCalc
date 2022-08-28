function utf8_to_b64(str) {
    return window.btoa(unescape(encodeURIComponent(str)));
}

function b64_to_utf8(str) {
    return decodeURIComponent(escape(window.atob(str)));
}

function evalMath() {
    var parser = math.parser();
    var output = '';
    var input = [];
    var formulas = $('#frame1').val();
    
    if(formulas.includes(",")&&!formulas.includes(".")) {
        formulas = formulas.replace(/(\d+),(\d+)/gi, "$1.$2");
    }
    
    var arrayOfLines = formulas.split('\n');

    $.each(arrayOfLines, function(index, item) {
        try {
            parser.evaluate(item)
        } catch (err) {
            output += item + '    = ' + err + '\n';
            return
        }

        input.push(item)

        if (parser.evaluate(input) === undefined || item.trim() == '') {
            output += item + '\n';
        } else {
            var ev_raw = parser.evaluate(input).slice(-1);
            var ev_str = JSON.stringify(parser.evaluate(input).slice(-1));

            if (ev_raw !== undefined && ev_str !== "[null]") {
                output += item + '    = ' + ev_raw + '\n';
            } else {
                output += item + '\n';
            }
        }
    });
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
    var element = document.createElement('a');
    element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
    element.setAttribute('download', filename);

    element.style.display = 'none';
    document.body.appendChild(element);

    element.click();

    document.body.removeChild(element);
}

function downloadMath() {
    var filename = window.prompt('Save calculation as:', 'liveCalc.txt');
    var content = $("#highlights1").text().replace(/ +/g, " ");
    download(filename, content);
    return false;
}

function copyURLtoClipboard() {
    navigator.clipboard.writeText(window.location.href);
}
