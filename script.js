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
    var arrayOfLines = $('#frame1').val().split('\n');

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
    download('liveCalc.output.txt', $("#highlights1").text());
    return false;
}

function copyURLtoClipboard() {
    navigator.clipboard.writeText(window.location.href);
}
