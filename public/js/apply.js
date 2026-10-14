(function () {
  const il = document.getElementById('il'), dl = document.getElementById('ilceler'), ilce = document.getElementById('ilce');
  if (!il || !dl || !ilce) return;
  if (window.ILLER) window.ILLER.forEach(n => il.add(new Option(n, n)));
  il.addEventListener('change', () => {
    dl.innerHTML = '';
    ilce.value = '';
    const list = (window.ILCELER && window.ILCELER[il.value]) || [];
    list.forEach(d => dl.appendChild(new Option(d)));
    ilce.placeholder = il.value ? 'İlçe seçin veya yazın' : 'Önce il seçiniz';
  });
})();
