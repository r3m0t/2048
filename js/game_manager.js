function GameManager(size, InputManager, Actuator, ScoreManager) {
  var self = this;
  this.size         = size; // Size of the grid
  this.inputManager = new InputManager;
  this.scoreManager = new ScoreManager;
  this.actuator     = new Actuator;
  this.master      = true;

  this.startTiles   = 2;

  this.inputManager.on("move", this.move.bind(this));
  this.inputManager.on("restart", this.restart.bind(this));
  this.inputManager.on("keepPlaying", this.keepPlaying.bind(this));
  var runForever = document.querySelector(".forever-button");
  runForever.addEventListener("click", this.runStrategyForever.bind(this));
  TogetherJS.on("ready", function () {
    self.setMaster(TogetherJS.startup.reason !== "joined");
  });
  TogetherJS.on("close", function () {
    var wasMaster = self.master;
    self.setMaster(true);
    if (!wasMaster) {
      // no game stealing
      self.setup();
    }
  });
  TogetherJS.hub.on("togetherjs.hello", function (msg) {
    if (!msg.sameUrl) return;
    self.broadcastActuate();
  });
  TogetherJS.hub.on("actuate", function (msg) {
    self.setMaster(false);
    self.keepPlaying = msg.keepPlaying;
    self.grid = msg.grid;
    self.score = msg.score;
    self.over = msg.over;
    self.won = msg.won;
    self.actuator.continue();
    self.actuate();
  });
  TogetherJS.hub.on("continue", function (msg) {
    self.setMaster(false);
    self.actuator.continue();
  });

  this.setup();
}

// Restart the game
GameManager.prototype.restart = function () {
  if (!this.master) return;
  this.actuator.continue();
  this.broadcast({type: "continue"});
  this.setup();
};

// Keep playing after winning
GameManager.prototype.keepPlaying = function () {
  if (!this.master) return;
  this.keepPlaying = true;
  this.actuator.continue();
  this.broadcast({type: "continue"});
};

GameManager.prototype.isGameTerminated = function () {
  if (this.over || (this.won && !this.keepPlaying)) {
    return true;
  } else {
    return false;
  }
};

// Set up the game
GameManager.prototype.setup = function () {
  this.grid        = new Grid(this.size);

  this.score       = 0;
  this.over        = false;
  this.won         = false;
  this.keepPlaying = false;

  // Add the initial tiles
  this.addStartTiles();

  // Update the actuator
  this.actuate();
};

// Set up the initial tiles to start the game with
GameManager.prototype.addStartTiles = function () {
  for (var i = 0; i < this.startTiles; i++) {
    this.addRandomTile();
  }
};

// Adds a tile in a random position
GameManager.prototype.addRandomTile = function () {
  if (this.grid.cellsAvailable()) {
    var value = Math.random() < 0.9 ? 2 : 4;
    var tile = new Tile(this.grid.randomAvailableCell(), value);

    this.grid.insertTile(tile);
  }
};

GameManager.prototype.broadcast = function (msg) {
  if (TogetherJS.running && this.master) {
    TogetherJS.send(msg);
  }
};

GameManager.prototype.broadcastActuate = function () {
  this.broadcast({type: "actuate", grid: this.grid,
    score:      this.score,
    over:       this.over,
    won:        this.won,
    keepPlaying:this.keepPlaying
  });
};

// Sends the updated grid to the actuator
GameManager.prototype.actuate = function () {
  if (this.scoreManager.get() < this.score) {
    this.scoreManager.set(this.score);
  }

  this.broadcastActuate();

  this.actuator.actuate(this.grid, {
    score:      this.score,
    over:       this.over,
    won:        this.won,
    playing:    this.master,
    bestScore:  this.scoreManager.get(),
    terminated: this.isGameTerminated()
  });

};

// Save all tile positions and remove merger info
GameManager.prototype.prepareTiles = function (grid) {
  grid.eachCell(function (x, y, tile) {
    if (tile) {
      tile.mergedFrom = null;
      tile.savePosition();
    }
  });
};

// Move a tile and its representation
GameManager.prototype.moveTile = function (grid, tile, cell) {
  grid.cells[tile.x][tile.y] = null;
  grid.cells[cell.x][cell.y] = tile;
  tile.updatePosition(cell);
};

// Move tiles on the grid in the specified direction
GameManager.prototype.move = function (direction) {
  // 0: up, 1: right, 2: down, 3: left
  if (direction == 4) {
    direction = this.getStrategicDirection(this.grid);
    if (direction === false) return;
  }
  if (!this.master) return;

  if (this.isGameTerminated()) return; // Don't do anything if the game's over

  var cell, tile;

  var result = this.processMove(this.grid, direction);
  this.won = result.won;
  this.score += result.score;

  if (result.moved) {
    this.addRandomTile();

    if (!this.movesAvailable(this.grid)) {
      this.over = true; // Game over!
    }

    this.actuate();
  }
};

GameManager.prototype.runStrategyForever = function () {
  if (this.isGameTerminated()) {
    this.restart();
  } else {
    this.move(4);
  }
  if (this.isGameTerminated()) {
    var whales = this.whales(this.grid);
    console.warn("Score:", this.score, "biggest piece", whales[0].value, "*", whales.length);
  }
  var timeout = this.isGameTerminated() ? 3000 : 10;
  window.setTimeout(this.runStrategyForever.bind(this), timeout);
};

GameManager.prototype.whales = function (grid) {
  var maxTiles = [new Tile({x:-1,y:-1}, -1)];
  grid.eachCell(function (x, y, tile) {
    if (tile) {
      if (tile.value > maxTiles[0].value) {
        maxTiles = [tile];
      } else if (tile.value == maxTiles[0].value) {
        maxTiles.push(tile);
      }
    }
  });
  return maxTiles;
};

GameManager.prototype.processMove = function (grid, direction) {
  var self = this;
  var result = {won: false, over: false, moved: false, score: 0};
  var vector     = this.getVector(direction);
  var traversals = this.buildTraversals(vector);

  // Save the current tile positions and remove merger information
  this.prepareTiles(grid);

  // Traverse the grid in the right direction and move tiles
  traversals.x.forEach(function (x) {
    traversals.y.forEach(function (y) {
      cell = { x: x, y: y };
      tile = grid.cellContent(cell);

      if (tile) {
        var positions = self.findFarthestPosition(grid, cell, vector);
        var next      = grid.cellContent(positions.next);

        // Only one merger per row traversal?
        if (next && next.value === tile.value && !next.mergedFrom) {
          var merged = new Tile(positions.next, tile.value * 2);
          merged.mergedFrom = [tile, next];

          grid.insertTile(merged);
          grid.removeTile(tile);

          // Converge the two tiles' positions
          tile.updatePosition(positions.next);

          // Update the score
          result.score += merged.value;

          // The mighty 2048 tile
          if (merged.value === 2048) result.won = true;
        } else {
          self.moveTile(grid, tile, positions.farthest);
        }

        if (!self.positionsEqual(cell, tile)) {
          result.moved = true; // The tile moved from its original cell!
        }
      }
    });
  });
  return result;
};

GameManager.prototype.getStrategicDirection = function (grid) {
  // 0: up, 1: right, 2: down, 3: left
  var possibleDirections = [];

  // find a whale
  var maxTiles = this.whales(grid);
  var whaleXs = maxTiles.map(function (t) { return t.x; });
  var whaleYs = maxTiles.map(function (t) { return t.y; });
  var whaleDirections = [];
  if (maxTiles[0].value >= 16) {
    /* directions that would let a new piece in behind the whales */
    if (whaleXs.indexOf(0) > -1) whaleDirections.push(1);
    if (whaleXs.indexOf(3) > -1) whaleDirections.push(3);
    if (whaleYs.indexOf(0) > -1) whaleDirections.push(2);
    if (whaleYs.indexOf(3) > -1) whaleDirections.push(0);
  }

  var pStillPlayable;
  var insertables = [[2,0.9], [4,0.1]];
  for (var i = 0; i < 4; i++) {
    var gridCopy = grid.copy();
    var result = this.processMove(gridCopy, i);
    // if we can win, do so
    if (result.won) return i;
    if (!result.moved) continue;
    if (grid.availableCells().length > 1) {
      pStillPlayable = 1.0;
    } else {
    }
    possibleDirections.push({
      direction: i,
      whaleScore: (whaleDirections.indexOf(i) > -1) ? -1 : 0,
      score: result.score,
    });
  }
  // if no moves, do nothing
  if (possibleDirections.length == 0) return false;
  // if one move, do it
  if (possibleDirections.length == 1) return possibleDirections[0].direction;

  var myScorer = scorer('whaleScore','score','direction');

  possibleDirections.sort(myScorer);
  // impossible atm, I put direction in!
  if (myScorer(possibleDirections[0], possibleDirections[1]) == 0) {
    return false;
  }
  //possibleDirections.sort(scorer('score', 'direction'));
  console.log(JSON.stringify(possibleDirections));
  return possibleDirections[0].direction;

  if (possibleDirections.length == 1) {
    return possibleDirections[0].direction;
  }
  return false;
  function scorer() {
    var args = arguments;
    return function(a, b) {
      var s = 0;
      for (var i = 0, ii = args.length; i < ii; i++) {
        s = b[args[i]] - a[args[i]];
        if (s != 0) break;
      }
      return s;
    };
  }
}

GameManager.prototype.scoreGrid = function (grid) {
}

// Get the vector representing the chosen direction
GameManager.prototype.getVector = function (direction) {
  // Vectors representing tile movement
  var map = {
    0: { x: 0,  y: -1 }, // up
    1: { x: 1,  y: 0 },  // right
    2: { x: 0,  y: 1 },  // down
    3: { x: -1, y: 0 }   // left
  };

  return map[direction];
};

// Build a list of positions to traverse in the right order
GameManager.prototype.buildTraversals = function (vector) {
  var traversals = { x: [], y: [] };

  for (var pos = 0; pos < this.size; pos++) {
    traversals.x.push(pos);
    traversals.y.push(pos);
  }

  // Always traverse from the farthest cell in the chosen direction
  if (vector.x === 1) traversals.x = traversals.x.reverse();
  if (vector.y === 1) traversals.y = traversals.y.reverse();

  return traversals;
};

GameManager.prototype.findFarthestPosition = function (grid, cell, vector) {
  var previous;

  // Progress towards the vector direction until an obstacle is found
  do {
    previous = cell;
    cell     = { x: previous.x + vector.x, y: previous.y + vector.y };
  } while (grid.withinBounds(cell) &&
           grid.cellAvailable(cell));

  return {
    farthest: previous,
    next: cell // Used to check if a merge is required
  };
};

GameManager.prototype.movesAvailable = function (grid) {
  return grid.cellsAvailable() || this.tileMatchesAvailable(grid);
};

GameManager.prototype.setMaster = function (master) {
  // TODO inputManager
  this.inputManager.setActive(master);
  this.master = master;
};

// Check for available matches between tiles (more expensive check)
GameManager.prototype.tileMatchesAvailable = function (grid) {
  var self = this;

  var tile;

  for (var x = 0; x < this.size; x++) {
    for (var y = 0; y < this.size; y++) {
      tile = grid.cellContent({ x: x, y: y });

      if (tile) {
        for (var direction = 0; direction < 4; direction++) {
          var vector = self.getVector(direction);
          var cell   = { x: x + vector.x, y: y + vector.y };

          var other  = self.grid.cellContent(cell);

          if (other && other.value === tile.value) {
            return true; // These two tiles can be merged
          }
        }
      }
    }
  }

  return false;
};

GameManager.prototype.positionsEqual = function (first, second) {
  return first.x === second.x && first.y === second.y;
};
