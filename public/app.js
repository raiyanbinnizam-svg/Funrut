const $ = (sel) => document.querySelector(sel);

let current = null;
let busy = false;

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function renderCard(el, entry) {
  el.replaceChildren();
  el.classList.remove('picked', 'dimmed');
  el.dataset.id = entry.id;
  const img = document.createElement('img');
  img.src = entry.image;
  img.alt = entry.name;
  const meta = document.createElement('div');
  meta.className = 'meta';
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = entry.name;
  const rating = document.createElement('span');
  rating.className = 'rating';
  rating.textContent = entry.rating;
  meta.append(name, rating);
  el.append(img, meta);
}

async function loadPair() {
  try {
    current = await api('/api/pair');
    renderCard($('#left'), current.left);
    renderCard($('#right'), current.right);
  } catch (err) {
    $('#result').textContent = err.message;
  } finally {
    busy = false;
    $('.arena').classList.remove('busy');
  }
}

function fmtDelta(n) {
  return `${n >= 0 ? '+' : ''}${n}`;
}

async function vote(side) {
  if (busy || !current) return;
  busy = true;
  $('.arena').classList.add('busy');
  const pickedEl = side === 'left' ? $('#left') : $('#right');
  const otherEl = side === 'left' ? $('#right') : $('#left');
  pickedEl.classList.add('picked');
  otherEl.classList.add('dimmed');

  try {
    const { winner, loser } = await api('/api/vote', {
      method: 'POST',
      body: JSON.stringify({ token: current.token, winnerId: pickedEl.dataset.id }),
    });
    const result = $('#result');
    result.replaceChildren(
      `${winner.name} `,
      Object.assign(document.createElement('span'), { className: 'up', textContent: fmtDelta(winner.delta) }),
      ` · ${loser.name} `,
      Object.assign(document.createElement('span'), { className: 'down', textContent: fmtDelta(loser.delta) }),
    );
  } catch (err) {
    $('#result').textContent = err.message;
  }
  setTimeout(loadPair, 450);
}

async function loadBoard() {
  const { entries, votes } = await api('/api/leaderboard');
  $('#vote-count').textContent = `${votes.toLocaleString()} votes cast`;
  const board = $('#board');
  board.replaceChildren(
    ...entries.map((e) => {
      const li = document.createElement('li');
      const img = Object.assign(document.createElement('img'), { src: e.image, alt: '' });
      const info = document.createElement('div');
      info.append(
        Object.assign(document.createElement('div'), { className: 'name', textContent: e.name }),
        Object.assign(document.createElement('div'), { className: 'record', textContent: `${e.wins}W – ${e.losses}L` }),
      );
      const score = Object.assign(document.createElement('span'), { className: 'score', textContent: e.rating });
      li.append(img, info, score);
      return li;
    }),
  );
}

function show(view) {
  document.querySelectorAll('.tab[data-view]').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
  if (view === 'board') loadBoard().catch((err) => ($('#vote-count').textContent = err.message));
}

document.querySelectorAll('.tab[data-view]').forEach((t) => t.addEventListener('click', () => show(t.dataset.view)));
$('#left').addEventListener('click', () => vote('left'));
$('#right').addEventListener('click', () => vote('right'));
document.addEventListener('keydown', (e) => {
  if (!$('#view-vote').classList.contains('active')) return;
  if (e.key === 'ArrowLeft') vote('left');
  if (e.key === 'ArrowRight') vote('right');
});

// ---------- join form ----------

let imageData = null;

$('#file').addEventListener('change', () => {
  const file = $('#file').files[0];
  imageData = null;
  $('#form-msg').textContent = '';
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    $('#form-msg').textContent = 'Image must be 2 MB or smaller.';
    $('#file').value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    imageData = reader.result;
    $('#preview').src = imageData;
    $('#preview').hidden = false;
    $('#drop-text').hidden = true;
  };
  reader.readAsDataURL(file);
});

$('#join-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!imageData) return;
  const button = e.submitter;
  button.disabled = true;
  $('#form-msg').textContent = '';
  try {
    const entry = await api('/api/entries', {
      method: 'POST',
      body: JSON.stringify({ name: $('#name').value, image: imageData, consent: $('#consent').checked }),
    });
    $('#join-form').reset();
    imageData = null;
    $('#preview').hidden = true;
    $('#drop-text').hidden = false;
    $('#form-msg').textContent = `Welcome, ${entry.name}! You're in the arena.`;
  } catch (err) {
    $('#form-msg').textContent = err.message;
  } finally {
    button.disabled = false;
  }
});

loadPair();
