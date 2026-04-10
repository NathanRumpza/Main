// ============================================================
// SOLITAIRE PRIZE WHEEL — Full Game
// ============================================================

(() => {
  'use strict';

  // ---- Constants ----
  const SUITS = ['♠', '♥', '♣', '♦'];
  const SUIT_NAMES = ['spades', 'hearts', 'clubs', 'diamonds'];
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const RED_SUITS = new Set(['♥', '♦']);

  const TIERS = {
    bronze:  { cost: 100,  multipliers: [1, 1.5, 2, 2, 2.5, 3, 3, 4, 5],   colors: ['#cd7f32','#a0622a'] },
    silver:  { cost: 500,  multipliers: [1, 1.5, 2, 2, 3, 3, 4, 5, 8],     colors: ['#c0c0c0','#888'] },
    gold:    { cost: 1000, multipliers: [1, 2, 2, 3, 3, 4, 5, 8, 12],      colors: ['#f0c040','#c89b20'] },
    diamond: { cost: 5000, multipliers: [1, 2, 3, 3, 4, 5, 8, 12, 20],     colors: ['#b9f2ff','#5bc0de'] },
  };

  const WHEEL_COLORS = [
    '#e74c3c', '#3498db', '#2ecc71', '#f39c12',
    '#9b59b6', '#1abc9c', '#e67e22', '#2980b9', '#27ae60'
  ];

  // ---- State ----
  let coins = parseInt(localStorage.getItem('solitaire-coins')) || 1000;
  let currentTier = null;
  let currentCost = 0;

  // Solitaire state
  let stock = [];
  let waste = [];
  let wasteViewCount = 0; // how many waste cards are visible in the current fan
  let foundations = [[], [], [], []];
  let tableau = [[], [], [], [], [], [], []];
  let undoStack = [];
  let selectedCard = null;
  let dragState = null;
  let hintCards = [];
  let moveCount = 0;
  let movesAtLastRecycle = -1;
  let gameActive = false;

  // ---- DOM refs ----
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const screens = {
    menu: $('#menu-screen'),
    game: $('#game-screen'),
    wheel: $('#wheel-screen'),
    lose: $('#lose-screen'),
    bankrupt: $('#bankrupt-screen'),
  };

  // ---- Helpers ----
  function saveCoins() {
    localStorage.setItem('solitaire-coins', coins);
  }

  function updateCoinDisplays() {
    const displays = ['#menu-coins', '#game-coins'];
    displays.forEach(sel => {
      const el = $(sel);
      if (el) el.textContent = coins.toLocaleString();
    });
  }

  function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
  }

  function rankValue(rank) {
    return RANKS.indexOf(rank);
  }

  function isRed(suit) {
    return RED_SUITS.has(suit);
  }

  function oppositeColor(suit1, suit2) {
    return isRed(suit1) !== isRed(suit2);
  }

  // ---- Deck & Dealing ----
  function createDeck() {
    const deck = [];
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        deck.push({ suit, rank, faceUp: false });
      }
    }
    return deck;
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function deal() {
    const deck = shuffle(createDeck());
    tableau = [[], [], [], [], [], [], []];
    foundations = [[], [], [], []];
    waste = [];
    stock = [];
    undoStack = [];
    selectedCard = null;
    wasteViewCount = 0;
    moveCount = 0;
    movesAtLastRecycle = -1;

    let idx = 0;
    for (let col = 0; col < 7; col++) {
      for (let row = 0; row <= col; row++) {
        const card = deck[idx++];
        card.faceUp = (row === col);
        tableau[col].push(card);
      }
    }
    stock = deck.slice(idx);
    stock.forEach(c => c.faceUp = false);
  }

  // ---- Save state for undo ----
  function saveState() {
    undoStack.push({
      stock: stock.map(c => ({ ...c })),
      waste: waste.map(c => ({ ...c })),
      wasteViewCount,
      foundations: foundations.map(f => f.map(c => ({ ...c }))),
      tableau: tableau.map(t => t.map(c => ({ ...c }))),
    });
    if (undoStack.length > 50) undoStack.shift();
  }

  function undo() {
    if (undoStack.length === 0) return;
    const state = undoStack.pop();
    stock = state.stock;
    waste = state.waste;
    wasteViewCount = state.wasteViewCount;
    foundations = state.foundations;
    tableau = state.tableau;
    selectedCard = null;
    clearHints();
    render();
  }

  // ---- Card Rendering ----
  function createCardElement(card, location, index, totalInPile) {
    const el = document.createElement('div');
    el.className = 'card' + (isRed(card.suit) ? ' red' : ' black');
    el.dataset.location = location;
    el.dataset.index = index;

    if (card.faceUp) {
      el.innerHTML = `
        <div class="card-face">
          <div class="card-top">${card.rank}${card.suit}</div>
          <div class="card-center">${card.suit}</div>
          <div class="card-bottom">${card.rank}${card.suit}</div>
        </div>`;
    } else {
      el.innerHTML = '<div class="card-back"></div>';
    }

    return el;
  }

  function render() {
    // Move counter
    const mc = $('#move-counter');
    if (mc) mc.textContent = moveCount + (moveCount === 1 ? ' move' : ' moves');

    // Stock
    const stockEl = $('#stock');
    stockEl.innerHTML = stock.length > 0
      ? '<div class="card"><div class="card-back"></div></div>'
      : '<div class="slot-label">♻</div>';
    stockEl.className = 'card-slot stock-slot' + (stock.length === 0 ? ' empty-stock' : '');

    // Waste — show the current draw group fanned (1-3 cards)
    const wasteEl = $('#waste');
    wasteEl.innerHTML = '';
    if (waste.length > 0) {
      const showCount = Math.min(wasteViewCount || 1, waste.length);
      const startIdx = waste.length - showCount;
      for (let i = 0; i < showCount; i++) {
        const card = waste[startIdx + i];
        const cardEl = createCardElement(card, 'waste', startIdx + i);
        cardEl.style.position = 'absolute';
        cardEl.style.top = '0';
        cardEl.style.left = (i * 22) + 'px';
        cardEl.style.zIndex = i + 1;
        // Only the top card is clickable/selectable
        if (i < showCount - 1) {
          cardEl.style.pointerEvents = 'none';
        }
        wasteEl.appendChild(cardEl);
      }
    }

    // Foundations
    for (let i = 0; i < 4; i++) {
      const fEl = $(`#foundation-${i}`);
      fEl.innerHTML = '';
      const pile = foundations[i];
      if (pile.length > 0) {
        const card = pile[pile.length - 1];
        const cardEl = createCardElement(card, `foundation-${i}`, pile.length - 1);
        cardEl.style.position = 'absolute';
        cardEl.style.top = '0';
        cardEl.style.left = '0';
        fEl.appendChild(cardEl);
      } else {
        fEl.innerHTML = `<div class="slot-label">${SUITS[i]}</div>`;
      }
    }

    // Tableau
    for (let col = 0; col < 7; col++) {
      const tEl = $(`#tableau-${col}`);
      tEl.innerHTML = '';
      const pile = tableau[col];
      pile.forEach((card, row) => {
        const cardEl = createCardElement(card, `tableau-${col}`, row, pile.length);
        const offset = card.faceUp
          ? (row > 0 ? getOffset(pile, row) : 0)
          : (row > 0 ? getOffset(pile, row) : 0);
        cardEl.style.position = 'absolute';
        cardEl.style.top = offset + 'px';
        cardEl.style.left = '0';
        cardEl.style.zIndex = row + 1;
        tEl.appendChild(cardEl);
      });
      // Set min height based on pile
      if (pile.length > 0) {
        const lastOffset = getOffset(pile, pile.length - 1);
        tEl.style.minHeight = (lastOffset + parseInt(getComputedStyle(document.documentElement).getPropertyValue('--card-height'))) + 'px';
      }
    }

    // Highlight selected
    if (selectedCard) {
      const { location, index } = selectedCard;
      const container = $(`#${location}`);
      if (container) {
        const cards = container.querySelectorAll('.card');
        if (location === 'waste') {
          // Waste: highlight the last DOM element (top card)
          if (cards.length > 0) cards[cards.length - 1].classList.add('selected');
        } else {
          // Tableau: highlight from index onwards
          for (let i = index; i < cards.length; i++) {
            if (cards[i]) cards[i].classList.add('selected');
          }
        }
      }
    }

    // Highlight hints (source + destination)
    hintCards.forEach(h => {
      const container = $(`#${h.location}`);
      if (!container) return;
      const cards = container.querySelectorAll('.card');

      if (h.isDestination) {
        // For destination, highlight the top card or the empty slot
        if (cards.length > 0) {
          cards[cards.length - 1].classList.add('hint-highlight');
        } else {
          container.classList.add('hint-highlight-slot');
        }
      } else {
        if (cards[h.index]) cards[h.index].classList.add('hint-highlight');
      }
    });
  }

  function getOffset(pile, row) {
    let offset = 0;
    const cascadeFace = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--cascade-offset-face')) || 32;
    const cascadeBack = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--cascade-offset')) || 22;
    for (let i = 0; i < row; i++) {
      offset += pile[i].faceUp ? cascadeFace : cascadeBack;
    }
    return offset;
  }

  function getPile(location) {
    if (location === 'waste') return waste;
    if (location.startsWith('foundation-')) return foundations[parseInt(location.split('-')[1])];
    if (location.startsWith('tableau-')) return tableau[parseInt(location.split('-')[1])];
    return null;
  }

  // ---- Game Logic ----
  function canMoveToFoundation(card, foundIdx) {
    const pile = foundations[foundIdx];
    if (pile.length === 0) return card.rank === 'A';
    const top = pile[pile.length - 1];
    return top.suit === card.suit && rankValue(card.rank) === rankValue(top.rank) + 1;
  }

  function canMoveToTableau(card, colIdx) {
    const pile = tableau[colIdx];
    if (pile.length === 0) return card.rank === 'K';
    const top = pile[pile.length - 1];
    return top.faceUp && oppositeColor(card.suit, top.suit) && rankValue(card.rank) === rankValue(top.rank) - 1;
  }

  function drawFromStock() {
    if (stock.length === 0) {
      if (waste.length === 0) return;
      // Check if we made any progress since last recycle
      if (movesAtLastRecycle === moveCount) {
        // Full pass with no moves — stuck
        if (!hasAnyMoves()) {
          showNoMovesModal();
          return;
        }
      }
      saveState();
      movesAtLastRecycle = moveCount;
      stock = waste.reverse();
      stock.forEach(c => c.faceUp = false);
      waste = [];
      wasteViewCount = 0;
    } else {
      saveState();
      const drawCount = Math.min(3, stock.length);
      for (let i = 0; i < drawCount; i++) {
        const card = stock.pop();
        card.faceUp = true;
        waste.push(card);
      }
      wasteViewCount = drawCount;
    }
    selectedCard = null;
    clearHints();
    render();
  }

  function trySelect(location, index) {
    const pile = getPile(location);
    if (!pile || index >= pile.length) return;
    const card = pile[index];
    if (!card.faceUp) return;

    // If something is already selected, try to move it here
    if (selectedCard) {
      if (tryMove(selectedCard.location, selectedCard.index, location)) {
        selectedCard = null;
        clearHints();
        render();
        checkWin();
        return;
      }
    }

    // Select this card
    selectedCard = { location, index };
    clearHints();
    render();
  }

  function tryClickEmptyTableau(colIdx) {
    if (selectedCard) {
      if (tryMove(selectedCard.location, selectedCard.index, `tableau-${colIdx}`)) {
        selectedCard = null;
        clearHints();
        render();
        checkWin();
      }
    }
  }

  function tryClickFoundation(foundIdx) {
    if (selectedCard) {
      if (tryMove(selectedCard.location, selectedCard.index, `foundation-${foundIdx}`)) {
        selectedCard = null;
        clearHints();
        render();
        checkWin();
      }
    }
  }

  function tryMove(fromLoc, fromIdx, toLoc) {
    const fromPile = getPile(fromLoc);
    const toPile = getPile(toLoc);
    if (!fromPile || !toPile) return false;

    const card = fromPile[fromIdx];
    if (!card || !card.faceUp) return false;

    // Move to foundation
    if (toLoc.startsWith('foundation-')) {
      const foundIdx = parseInt(toLoc.split('-')[1]);
      if (fromIdx !== fromPile.length - 1) return false; // Only top card
      if (!canMoveToFoundation(card, foundIdx)) return false;

      saveState();
      toPile.push(fromPile.pop());
      if (fromLoc === 'waste') wasteViewCount = Math.max(1, wasteViewCount - 1);
      flipTopCard(fromLoc);
      moveCount++;
      return true;
    }

    // Move to tableau
    if (toLoc.startsWith('tableau-')) {
      const colIdx = parseInt(toLoc.split('-')[1]);
      if (!canMoveToTableau(card, colIdx)) return false;

      saveState();
      const moving = fromPile.splice(fromIdx);
      toPile.push(...moving);
      if (fromLoc === 'waste') wasteViewCount = Math.max(1, wasteViewCount - 1);
      flipTopCard(fromLoc);
      moveCount++;
      return true;
    }

    return false;
  }

  function flipTopCard(location) {
    const pile = getPile(location);
    if (pile && pile.length > 0 && !pile[pile.length - 1].faceUp) {
      pile[pile.length - 1].faceUp = true;
    }
  }

  // ---- Double click: auto-move to foundation ----
  function tryAutoMove(location, index) {
    const pile = getPile(location);
    if (!pile || !pile[index] || !pile[index].faceUp) return false;
    const card = pile[index];

    // 1. Try foundations (only top card of a pile)
    if (index === pile.length - 1) {
      for (let i = 0; i < 4; i++) {
        if (canMoveToFoundation(card, i)) {
          saveState();
          foundations[i].push(pile.pop());
          if (location === 'waste') wasteViewCount = Math.max(1, wasteViewCount - 1);
          flipTopCard(location);
          moveCount++;
          selectedCard = null;
          clearHints();
          render();
          checkWin();
          return true;
        }
      }
    }

    // 2. Try tableau columns (supports moving stacks)
    const fromCol = location.startsWith('tableau-') ? parseInt(location.split('-')[1]) : -1;
    for (let col = 0; col < 7; col++) {
      if (col === fromCol) continue;
      if (canMoveToTableau(card, col)) {
        // Skip moving a King to an empty column if it's already at the base
        if (card.rank === 'K' && index === 0 && tableau[col].length === 0) continue;
        if (tryMove(location, index, `tableau-${col}`)) {
          selectedCard = null;
          clearHints();
          render();
          checkWin();
          return true;
        }
      }
    }

    return false;
  }

  // ---- Auto-complete ----
  function canAutoComplete() {
    // All cards face up and stock/waste empty
    if (stock.length > 0 || waste.length > 0) return false;
    for (const col of tableau) {
      for (const card of col) {
        if (!card.faceUp) return false;
      }
    }
    return true;
  }

  function autoComplete() {
    if (!gameActive) return;

    const banner = document.createElement('div');
    banner.className = 'auto-complete-banner';
    banner.innerHTML = '<h3>Auto-completing!</h3><p>All cards are face up</p>';
    document.body.appendChild(banner);

    let interval = setInterval(() => {
      let moved = false;
      // Try waste first
      if (waste.length > 0) {
        const card = waste[waste.length - 1];
        for (let i = 0; i < 4; i++) {
          if (canMoveToFoundation(card, i)) {
            foundations[i].push(waste.pop());
            moved = true;
            break;
          }
        }
      }
      // Try tableau
      if (!moved) {
        for (let col = 0; col < 7; col++) {
          const pile = tableau[col];
          if (pile.length === 0) continue;
          const card = pile[pile.length - 1];
          for (let i = 0; i < 4; i++) {
            if (canMoveToFoundation(card, i)) {
              foundations[i].push(pile.pop());
              moved = true;
              break;
            }
          }
          if (moved) break;
        }
      }

      render();

      if (!moved || checkWinSilent()) {
        clearInterval(interval);
        banner.remove();
        if (checkWinSilent()) {
          handleWin();
        }
      }
    }, 120);
  }

  // ---- Win Check ----
  function checkWinSilent() {
    return foundations.every(f => f.length === 13);
  }

  function checkWin() {
    if (checkWinSilent()) {
      handleWin();
      return;
    }
    if (canAutoComplete()) {
      autoComplete();
      return;
    }
    if (gameActive && !hasAnyMoves()) {
      showNoMovesModal();
    }
  }

  function hasAnyMoves() {
    // Check waste top card for moves
    if (waste.length > 0) {
      const card = waste[waste.length - 1];
      for (let i = 0; i < 4; i++) {
        if (canMoveToFoundation(card, i)) return true;
      }
      for (let col = 0; col < 7; col++) {
        if (canMoveToTableau(card, col)) return true;
      }
    }

    // Check tableau cards for moves
    for (let fromCol = 0; fromCol < 7; fromCol++) {
      const pile = tableau[fromCol];
      if (pile.length === 0) continue;

      // Top card to foundation?
      const top = pile[pile.length - 1];
      for (let i = 0; i < 4; i++) {
        if (canMoveToFoundation(top, i)) return true;
      }

      // Any face-up card to another tableau column?
      for (let r = 0; r < pile.length; r++) {
        if (!pile[r].faceUp) continue;
        for (let toCol = 0; toCol < 7; toCol++) {
          if (fromCol === toCol) continue;
          if (canMoveToTableau(pile[r], toCol)) return true;
        }
      }
    }

    // Can draw from stock?
    if (stock.length > 0) return true;

    // Can recycle waste? Only counts if we haven't already been through
    // a full pass without making progress
    if (waste.length > 0 && moveCount > movesAtLastRecycle) return true;

    return false;
  }

  function showNoMovesModal() {
    if (!gameActive) return;
    gameActive = false;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box">
        <h3>No Moves Left</h3>
        <p>There are no more available moves. You lose your ${currentCost.toLocaleString()} coin stake.</p>
        <div class="modal-buttons">
          <button class="modal-btn confirm" id="no-moves-btn">OK</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#no-moves-btn').addEventListener('click', () => {
      overlay.remove();
      handleLose();
    });
  }

  function handleWin() {
    gameActive = false;
    setTimeout(() => {
      showWheelScreen();
    }, 500);
  }

  // ---- Hints ----
  function findHint() {
    clearHints();

    // Collect all possible moves, scored by usefulness
    const moves = [];

    // Helper: does moving from this location reveal a face-down card?
    function revealsCard(location, index) {
      const pile = getPile(location);
      if (!pile || index === 0) return false;
      return !pile[index - 1].faceUp;
    }

    // 1. Foundation moves (highest priority)
    // Check waste -> foundation
    if (waste.length > 0) {
      const card = waste[waste.length - 1];
      for (let i = 0; i < 4; i++) {
        if (canMoveToFoundation(card, i)) {
          moves.push({ from: { location: 'waste', index: waste.length - 1 }, to: { location: `foundation-${i}`, index: 0 }, score: 100 });
        }
      }
    }
    // Check tableau -> foundation
    for (let col = 0; col < 7; col++) {
      const pile = tableau[col];
      if (pile.length === 0) continue;
      const card = pile[pile.length - 1];
      for (let i = 0; i < 4; i++) {
        if (canMoveToFoundation(card, i)) {
          const reveals = revealsCard(`tableau-${col}`, pile.length - 1);
          moves.push({ from: { location: `tableau-${col}`, index: pile.length - 1 }, to: { location: `foundation-${i}`, index: 0 }, score: reveals ? 95 : 90 });
        }
      }
    }

    // 2. Tableau moves that reveal face-down cards (high priority)
    for (let fromCol = 0; fromCol < 7; fromCol++) {
      const fromPile = tableau[fromCol];
      for (let i = 0; i < fromPile.length; i++) {
        const card = fromPile[i];
        if (!card.faceUp) continue;
        const reveals = revealsCard(`tableau-${fromCol}`, i);
        for (let toCol = 0; toCol < 7; toCol++) {
          if (fromCol === toCol) continue;
          if (!canMoveToTableau(card, toCol)) continue;

          // Skip: moving a King to an empty column when nothing is revealed
          if (card.rank === 'K' && tableau[toCol].length === 0 && !reveals) continue;

          // Skip: moving bottom face-up card to empty column (just shuffling, no reveal)
          if (tableau[toCol].length === 0 && i === 0) continue;

          if (reveals) {
            moves.push({ from: { location: `tableau-${fromCol}`, index: i }, to: { location: `tableau-${toCol}`, index: 0 }, score: 80 });
          } else {
            // Non-revealing move: only suggest if the card left behind can go to foundation
            if (i > 0 && fromPile[i - 1].faceUp) {
              const exposed = fromPile[i - 1];
              let exposedUseful = false;
              for (let f = 0; f < 4; f++) {
                if (canMoveToFoundation(exposed, f)) { exposedUseful = true; break; }
              }
              if (!exposedUseful) continue;
            }
            moves.push({ from: { location: `tableau-${fromCol}`, index: i }, to: { location: `tableau-${toCol}`, index: 0 }, score: 20 });
          }
        }
      }
    }

    // 3. Waste -> tableau (medium priority)
    if (waste.length > 0) {
      const card = waste[waste.length - 1];
      for (let col = 0; col < 7; col++) {
        if (canMoveToTableau(card, col)) {
          moves.push({ from: { location: 'waste', index: waste.length - 1 }, to: { location: `tableau-${col}`, index: 0 }, score: 50 });
        }
      }
    }

    // 4. King to empty column (only if it reveals a card)
    for (let fromCol = 0; fromCol < 7; fromCol++) {
      const fromPile = tableau[fromCol];
      for (let i = 0; i < fromPile.length; i++) {
        const card = fromPile[i];
        if (!card.faceUp || card.rank !== 'K') continue;
        if (i === 0) continue; // Already at base, no point
        const reveals = revealsCard(`tableau-${fromCol}`, i);
        if (!reveals) continue;
        for (let toCol = 0; toCol < 7; toCol++) {
          if (fromCol === toCol) continue;
          if (tableau[toCol].length !== 0) continue;
          moves.push({ from: { location: `tableau-${fromCol}`, index: i }, to: { location: `tableau-${toCol}`, index: 0 }, score: 75 });
          break; // Only need one empty column
        }
      }
    }

    if (moves.length === 0) {
      // No moves — suggest drawing from stock
      if (stock.length > 0) {
        const stockEl = $('#stock');
        stockEl.style.boxShadow = '0 0 0 3px #5f5';
        setTimeout(() => stockEl.style.boxShadow = '', 1500);
      }
      return;
    }

    // Deduplicate (same from location), keep highest scored
    const seen = new Set();
    const unique = [];
    moves.sort((a, b) => b.score - a.score);
    for (const m of moves) {
      const key = m.from.location + ':' + m.from.index;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(m);
      }
    }

    // Show the best hint — highlight both source and destination
    const best = unique[0];
    hintCards.push(best.from);
    hintCards.push({ ...best.to, isDestination: true });
    render();
  }

  function clearHints() {
    hintCards = [];
    $$('.hint-highlight').forEach(el => el.classList.remove('hint-highlight'));
    $$('.hint-highlight-slot').forEach(el => el.classList.remove('hint-highlight-slot'));
  }

  // ---- Give Up / Quit ----
  function handleGiveUp() {
    if (!gameActive) return;
    showConfirmModal('Quit Game?', `You'll lose your ${currentCost.toLocaleString()} coin stake.`, () => {
      gameActive = false;
      handleLose();
    });
  }

  function handleLose() {
    $('#lost-amount').textContent = currentCost.toLocaleString();
    $('#lose-coins').textContent = coins.toLocaleString();
    saveCoins();
    if (coins <= 0) {
      showScreen('bankrupt');
    } else {
      showScreen('lose');
    }
  }

  function showConfirmModal(title, text, onConfirm) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box">
        <h3>${title}</h3>
        <p>${text}</p>
        <div class="modal-buttons">
          <button class="modal-btn cancel">Cancel</button>
          <button class="modal-btn confirm">Quit</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.cancel').addEventListener('click', () => overlay.remove());
    overlay.querySelector('.confirm').addEventListener('click', () => {
      overlay.remove();
      onConfirm();
    });
  }

  // ---- Prize Wheel ----
  let wheelMultipliers = [];
  let wheelAngle = 0;
  let wheelSpinning = false;

  function showWheelScreen() {
    const tier = TIERS[currentTier];
    wheelMultipliers = [...tier.multipliers];
    // Shuffle multipliers for variety
    shuffle(wheelMultipliers);

    $('#wheel-stake').textContent = currentCost.toLocaleString();
    $('#spin-btn').disabled = false;
    $('#spin-btn').style.display = '';
    $('#wheel-result').classList.add('hidden');
    wheelAngle = 0;

    showScreen('wheel');
    drawWheel(0);
  }

  function drawWheel(rotation) {
    const canvas = $('#wheel-canvas');
    const ctx = canvas.getContext('2d');
    const size = canvas.width;
    const center = size / 2;
    const radius = center - 5;
    const segments = wheelMultipliers.length;
    const arc = (2 * Math.PI) / segments;

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.translate(center, center);
    ctx.rotate(rotation);

    for (let i = 0; i < segments; i++) {
      const angle = i * arc;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, radius, angle, angle + arc);
      ctx.closePath();
      ctx.fillStyle = WHEEL_COLORS[i % WHEEL_COLORS.length];
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Text
      ctx.save();
      ctx.rotate(angle + arc / 2);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 22px sans-serif';
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 3;
      ctx.fillText(wheelMultipliers[i] + 'x', radius * 0.65, 7);
      ctx.shadowBlur = 0;
      ctx.restore();
    }

    // Center circle
    ctx.beginPath();
    ctx.arc(0, 0, 25, 0, 2 * Math.PI);
    ctx.fillStyle = '#222';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.restore();
  }

  function spinWheel() {
    if (wheelSpinning) return;
    wheelSpinning = true;
    $('#spin-btn').disabled = true;

    const segments = wheelMultipliers.length;
    const arc = (2 * Math.PI) / segments;

    // Spin 5-8 full rotations plus a random offset
    const fullSpins = 5 + Math.floor(Math.random() * 3);
    const randomOffset = Math.random() * 2 * Math.PI;
    const totalRotation = fullSpins * 2 * Math.PI + randomOffset;

    const startAngle = wheelAngle;
    const duration = 4000;
    const startTime = performance.now();

    function animate(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = startAngle + totalRotation * eased;
      drawWheel(current);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        wheelAngle = current;
        wheelSpinning = false;
        // Read which segment the pointer actually landed on
        // Pointer is at top (-PI/2). In wheel-local coords: -PI/2 - rotation
        let pointerAngle = ((-Math.PI / 2 - wheelAngle) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
        let landedIdx = Math.floor(pointerAngle / arc) % segments;
        showWheelResult(wheelMultipliers[landedIdx]);
      }
    }

    requestAnimationFrame(animate);
  }

  function showWheelResult(multiplier) {
    const winnings = Math.floor(currentCost * multiplier);
    coins += winnings;
    saveCoins();

    $('#result-multiplier').textContent = multiplier + 'x';
    $('#result-coins').textContent = `+${winnings.toLocaleString()} coins!`;
    $('#spin-btn').style.display = 'none';
    $('#wheel-result').classList.remove('hidden');

    // Confetti
    spawnConfetti();

    updateCoinDisplays();
  }

  function spawnConfetti() {
    const colors = ['#f0c040', '#e74c3c', '#3498db', '#2ecc71', '#9b59b6', '#ff69b4'];
    for (let i = 0; i < 60; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.style.left = Math.random() * 100 + 'vw';
      piece.style.top = '-20px';
      piece.style.width = (6 + Math.random() * 8) + 'px';
      piece.style.height = (6 + Math.random() * 8) + 'px';
      piece.style.background = colors[Math.floor(Math.random() * colors.length)];
      piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
      piece.style.transform = `rotate(${Math.random() * 360}deg)`;
      document.body.appendChild(piece);

      const duration = 2000 + Math.random() * 2000;
      const xDrift = (Math.random() - 0.5) * 200;
      piece.animate([
        { top: '-20px', left: piece.style.left, opacity: 1 },
        { top: '110vh', left: `calc(${piece.style.left} + ${xDrift}px)`, opacity: 0 }
      ], { duration, easing: 'ease-out' }).onfinish = () => piece.remove();
    }
  }

  // ---- Drag & Drop ----
  function initDragDrop() {
    const board = $('#solitaire-board');

    board.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
  }

  function onPointerDown(e) {
    const cardEl = e.target.closest('.card');
    if (!cardEl) return;

    const location = cardEl.dataset.location;
    const index = parseInt(cardEl.dataset.index);

    if (!location) return;

    const pile = getPile(location);
    if (!pile || !pile[index] || !pile[index].faceUp) return;

    // For waste, only the top card is draggable
    if (location === 'waste' && index !== pile.length - 1) return;

    // Start potential drag
    dragState = {
      location,
      index,
      startX: e.clientX,
      startY: e.clientY,
      dragging: false,
      elements: [],
      offsetX: 0,
      offsetY: 0,
    };
  }

  function onPointerMove(e) {
    if (!dragState) return;

    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;

    if (!dragState.dragging && Math.abs(dx) + Math.abs(dy) > 8) {
      // Start dragging
      dragState.dragging = true;
      selectedCard = null;
      clearHints();

      const container = $(`#${dragState.location}`);
      const cards = container.querySelectorAll('.card');
      const pile = getPile(dragState.location);

      // For waste, grab the last DOM element (the top card)
      // For tableau, grab from the drag index onwards
      const startDom = dragState.location === 'waste'
        ? cards.length - 1
        : dragState.index;

      for (let i = startDom; i < cards.length; i++) {
        const el = cards[i];
        if (el) {
          const rect = el.getBoundingClientRect();
          dragState.elements.push({
            el,
            origRect: rect,
          });
          el.classList.add('dragging');
          el.style.position = 'fixed';
          el.style.left = rect.left + 'px';
          el.style.top = rect.top + 'px';
          el.style.width = rect.width + 'px';
          el.style.zIndex = 1000 + (i - startDom);
        }
      }
      dragState.offsetX = 0;
      dragState.offsetY = 0;
    }

    if (dragState.dragging) {
      dragState.elements.forEach(item => {
        item.el.style.left = (item.origRect.left + dx) + 'px';
        item.el.style.top = (item.origRect.top + dy) + 'px';
      });
    }
  }

  function onPointerUp(e) {
    if (!dragState) return;

    if (dragState.dragging) {
      // Find drop target
      dragState.elements.forEach(item => {
        item.el.style.pointerEvents = 'none';
      });

      const dropTarget = document.elementFromPoint(e.clientX, e.clientY);

      dragState.elements.forEach(item => {
        item.el.style.pointerEvents = '';
        item.el.classList.remove('dragging');
        item.el.style.position = '';
        item.el.style.left = '';
        item.el.style.top = '';
        item.el.style.width = '';
        item.el.style.zIndex = '';
      });

      const slot = dropTarget ? dropTarget.closest('.card-slot') : null;
      if (slot) {
        const targetLoc = slot.id;
        if (targetLoc && targetLoc !== dragState.location) {
          if (tryMove(dragState.location, dragState.index, targetLoc)) {
            selectedCard = null;
            clearHints();
            render();
            checkWin();
            dragState = null;
            return;
          }
        }
      }

      // Also check if dropped on a card
      const targetCard = dropTarget ? dropTarget.closest('.card') : null;
      if (targetCard && targetCard.dataset.location) {
        const targetLoc = targetCard.dataset.location;
        if (targetLoc !== dragState.location) {
          // For tableau, use the column, not the specific card
          const actualTarget = targetLoc.startsWith('tableau-') ? targetLoc : targetLoc;
          if (tryMove(dragState.location, dragState.index, actualTarget)) {
            selectedCard = null;
            clearHints();
            render();
            checkWin();
            dragState = null;
            return;
          }
        }
      }

      render();
    }

    dragState = null;
  }

  // ---- Event Binding ----
  function initEvents() {
    // Tier selection
    $$('.tier-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const cost = parseInt(btn.dataset.cost);
        const tier = btn.dataset.tier;
        if (coins < cost) return;
        startGame(tier, cost);
      });
    });

    // Stock click — single handler for both draw and recycle
    $('#stock').addEventListener('click', (e) => {
      if (!gameActive) return;
      drawFromStock();
    });

    // Board clicks for card selection (with double-click detection)
    let lastClickTime = 0;
    let lastClickLoc = '';
    let lastClickIdx = -1;

    $('#solitaire-board').addEventListener('click', (e) => {
      if (!gameActive) return;
      if (dragState && dragState.dragging) return;

      const cardEl = e.target.closest('.card');
      const slot = e.target.closest('.card-slot');

      if (cardEl && cardEl.dataset.location) {
        const loc = cardEl.dataset.location;
        const idx = parseInt(cardEl.dataset.index);

        // Stock cards handled separately
        if (loc === 'stock') return;

        // Detect double-click: same card within 400ms
        const now = Date.now();
        if (loc === lastClickLoc && idx === lastClickIdx && now - lastClickTime < 400) {
          lastClickTime = 0;
          lastClickLoc = '';
          lastClickIdx = -1;
          selectedCard = null;
          tryAutoMove(loc, idx);
          return;
        }
        lastClickTime = now;
        lastClickLoc = loc;
        lastClickIdx = idx;

        trySelect(loc, idx);
        return;
      }

      // Clicked empty tableau slot
      if (slot && slot.id.startsWith('tableau-')) {
        const colIdx = parseInt(slot.id.split('-')[1]);
        if (tableau[colIdx].length === 0) {
          tryClickEmptyTableau(colIdx);
        }
        return;
      }

      // Clicked empty foundation slot
      if (slot && slot.id.startsWith('foundation-')) {
        const foundIdx = parseInt(slot.id.split('-')[1]);
        if (foundations[foundIdx].length === 0) {
          tryClickFoundation(foundIdx);
        }
        return;
      }
    });

    // Header buttons
    $('#quit-btn').addEventListener('click', handleGiveUp);
    $('#undo-btn').addEventListener('click', () => {
      if (gameActive) undo();
    });
    $('#hint-btn').addEventListener('click', () => {
      if (gameActive) findHint();
    });

    // Wheel
    $('#spin-btn').addEventListener('click', spinWheel);
    $('#collect-btn').addEventListener('click', () => {
      updateCoinDisplays();
      showScreen('menu');
      updateTierButtons();
    });

    // Lose/Bankrupt
    $('#lose-menu-btn').addEventListener('click', () => {
      if (coins <= 0) {
        showScreen('bankrupt');
      } else {
        showScreen('menu');
        updateCoinDisplays();
        updateTierButtons();
      }
    });

    $('#bankrupt-btn').addEventListener('click', () => {
      coins = 1000;
      saveCoins();
      updateCoinDisplays();
      updateTierButtons();
      showScreen('menu');
    });

    // Free coins when too low to play
    $('#free-coins-btn').addEventListener('click', () => {
      coins += 500;
      saveCoins();
      updateCoinDisplays();
      updateTierButtons();
    });

    // Keyboard
    document.addEventListener('keydown', (e) => {
      if (!gameActive) return;
      if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        undo();
      }
      if (e.key === 'h') findHint();
      if (e.key === 'Escape') {
        selectedCard = null;
        clearHints();
        render();
      }
    });

    initDragDrop();
  }

  // ---- Start / Setup ----
  function startGame(tier, cost) {
    currentTier = tier;
    currentCost = cost;
    coins -= cost;
    saveCoins();
    updateCoinDisplays();

    const badge = $('#stake-badge');
    badge.textContent = tier.charAt(0).toUpperCase() + tier.slice(1);
    badge.className = 'stake-badge ' + tier;

    // Apply tier theme
    const gameScreen = $('#game-screen');
    gameScreen.className = 'screen theme-' + tier;

    deal();
    gameActive = true;
    showScreen('game');
    render();
  }

  function updateTierButtons() {
    $$('.tier-btn').forEach(btn => {
      const cost = parseInt(btn.dataset.cost);
      btn.disabled = coins < cost;
    });
    // Show free coins button when player can't afford any game
    const freeBtn = $('#free-coins-btn');
    if (freeBtn) {
      freeBtn.style.display = coins < 100 ? '' : 'none';
    }
  }

  // ---- Init ----
  function init() {
    updateCoinDisplays();
    updateTierButtons();
    initEvents();
    showScreen('menu');
  }

  init();
})();
