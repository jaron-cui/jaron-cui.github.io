

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  

for(n = 0; n < 100; n += 1) {
    await sleep(1000)
    document.getElementById("display").innerHTML = toString(n)
}