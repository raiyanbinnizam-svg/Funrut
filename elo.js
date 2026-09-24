const K = 32;

function expected(ratingA, ratingB) {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

// Returns the new [winner, loser] ratings after one match.
function update(winnerRating, loserRating, k = K) {
  const expWin = expected(winnerRating, loserRating);
  const delta = k * (1 - expWin);
  return [winnerRating + delta, loserRating - delta];
}

module.exports = { expected, update, K };
