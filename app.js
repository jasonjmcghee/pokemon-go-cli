var async = require('async');
var readlineSync = require('readline-sync');
var stdin = process.openStdin();
var PokemonGO = require('./api/poke.io.js');

var client = new PokemonGO.Pokeio();

var debug = false;
var initialized = false;

var location = {
    'type': 'name',
    'name': 'Fremont'
};

var compare = function (x, y) {
    return ((x < y) ? -1 : ((x > y) ? 1 : 0));
};

var orders = {
    "nearest": function (pokemons) {
        return pokemons.reverse();
    },
    "cp": function (pokemons) {
        return pokemons.sort(function (a, b) {
            var x = getPokemonFromCell(a).pokemon_data;
            var y = getPokemonFromCell(b).pokemon_data;
            return compare(x.cp, y.cp);
        });
    }
};

var nearbyPokemons = [];

console.log("Welcome to PokemonGO CLI!");

var cmds = {
    "init": init,
    "profile": showProfile,
    "scan": scan,
    "catch": capture,
    "inventory": showInventory,
    "help": help
};

readlineSync.promptCLLoop(cmds);

function ask() {
    //process.stdout.write("> ");
}

function init() {
    var username;
    var provider;
    var password;

    try {
        username = arguments[0];
        provider = arguments[1];
        password = readlineSync.question('Password: ', { hideEchoBack: true});
    } catch (err) {
        console.log('[e] Error parsing init arguments');
        console.log(err);
        return;
    }

    client.init(username, password, location, provider, function (err) {
        if (err) {
            console.log("[e] Error initializing.");
            console.log(err);
            return;
        }

        initialized = true;
        console.log('[i] Current location: ' + client.playerInfo.locationName);
        console.log('[i] lat/long/alt: : ' + client.playerInfo.latitude + ' ' + client.playerInfo.longitude + ' ' + client.playerInfo.altitude);
    
        return;
    });
}

function showProfile() {
    if (!initialized) {
        console.log("[e] Error getting profile.");
        console.log("Client not initialized.");
        return;
    }

    client.GetProfile(function (err, profile) {
        if (err) {
            console.log("[e] Error getting profile.");
            console.log(err);
            return;
        }

        console.log('[i] Username: ' + profile.username);
        console.log('[i] Poke Storage: ' + profile.poke_storage);
        console.log('[i] Item Storage: ' + profile.item_storage);

        var poke = profile.currency[0].amount || 0;

        console.log('[i] Pokecoin: ' + poke);
        console.log('[i] Stardust: ' + profile.currency[1].amount);

        return;
    });
}

function scan() {
    if (!initialized) {
        console.log("[e] Error scanning.");
        console.log("Client not initialized.");
        return;
    }

    async.waterfall([
        function (callback) {
            if (arguments.length < 1) {
                return callback(null, location);
            }

            try {
                var commaSplit = arguments[0].split(',');
                var latitude = commaSplit[0].trim();
                var longitude = commaSplit[1].trim();
                location = {
                    'type': 'coords',
                    'coords': {
                        'latitude': parseFloat(latitude),
                        'longitude': parseFloat(longitude),
                        'altitude': 0
                    }
                };

                return callback(null, location);
            } catch (err) {
                callback("Wrong scan location format. Try 'scan 37.7749,-122.4194'");
                return;
            }
        },
        client.SetLocation,
        function (newLocation, callback) {
            console.log('[i] Scanning lat/long/alt: : ' + client.playerInfo.latitude + ' ' + client.playerInfo.longitude + ' ' + client.playerInfo.altitude);
            callback(null);
        },
        client.Heartbeat,
        function (scan, callback) {
            nearbyPokemons = [];

            // You can provide an ordering
            var orderString = arguments.length > 1 ? arguments[1] : "nearest";
            var order = orderString in orders  ? orders[orderString] : orders["nearest"];
            var cells = order(scan.cells);

            // Iterate through cells according to order fn
            cells.forEach(function (cell) {
                var pokemonInst = cell.NearbyPokemon[0];
                if (pokemonInst) {
                    var pokemon = getPokemon(pokemonInst.PokedexNumber);
                    console.log('[+] There is a ' + pokemon.name + ' at ' + pokemonInst.DistanceMeters.toString() + ' meters');
                }

                // Append nearby pokemon to list, ordered by our order fn
                nearbyPokemons.concat(cell.WildPokemon.map(function (currentPokemon) {
                    var pokedexInfo = getPokemon(currentPokemon.pokemon.PokemonId);
                    return {'pokemon': wild, 'pokedex': pokedexInfo};
                }));
            });

            nearbyPokemons.forEach(function (p, i) {
                console.log('[' + i + '] There is a ' + p.pokedexInfo.name + ' near! I can try to catch it!');
            });

            callback(null);
        }
    ], function (err) {
        if (err) {
            console.log("[e] Error scanning.");
            console.log(err);
        }

        return;
    });
}

function capture() {
    if (!initialized) {
        console.log("[e] Error catching pokemon.");
        console.log("Client not initialized.");
        return;
    }

    var index = arguments[0];
    if (index < 0 || index >= nearbyPokemons.length) {
        console.log("[e] Error catching pokemon.");
        console.log("Invalid pokemon index.");
        return;
    }

    var pokemonToCatch = nearbyPokemons[index].pokemon;
    var pokemonToCatchInfo = nearbyPokemons[index].pokedex;

    async.waterfall([
        client.Heartbeat,
        function (scan, callback) {
            for (var i = scan.cells.length - 1; i >= 0; i--) {
                for (var j = scan.cells[i].WildPokemon.length - 1; j >= 0; j--) {
                    var currentPokemon = scan.cells[i].WildPokemon[j];
                    if (JSON.stringify(currentPokemon.EncounterId) === JSON.stringify(pokemonToCatch.EncounterId)) {
                        pokemonToCatch = currentPokemon;
                        callback(null, currentPokemon);
                        return;
                    }
                }
            }

            callback("Pokemon " + pokemonToCatchInfo.name + " seem to have disappear.");
        },
        client.EncounterPokemon,
        function (encounterData, callback) {
            console.log('[i] Encountering pokemon ' + pokemonToCatchInfo.name + '...');

            async.doUntil(
                function (doUntilFnCallback) {
                    console.log('[i] Trying to catch pokemon ' + pokemonToCatchInfo.name + '...');
                    client.CatchPokemon(pokemonToCatch, 1, 1.950, 1, 1, doUntilFnCallback);
                },
                function (catchResult) {
                    var statusStr = ['Unexpected error', 'Successful catch', 'Catch Escape', 'Catch Flee', 'Missed Catch'];
                    var catchStatus = catchResult.Status;
                    console.log('[i] ' + statusStr[catchStatus]);
                    return catchStatus === 0 || catchStatus === 1 || catchStatus === 3;
                },
                callback
            );
        }
    ], function (err) {
        if (err) {
            console.log("[e] Error catching scanning.");
            console.log(err);
        }

        return;
    });
}

function showInventory() {
    if (!initialized) {
        console.log("[e] Error getting invenotry.");
        console.log("Client not initialized.");
        return;
    }

    if (arguments.length < 1) {
        console.log("[e] Error getting invenotry.");
        console.log("List not specify. Try 'inventory pokemons'.");
        return;
    }

    var itemList = arguments[0];

    client.GetInventory(function (err, inventory) {
        if (err) {
            console.log("[e] Error getting profile.");
            console.log(err);
            return;
        }

        if (itemList === 'pokemons') {
            console.log("[i] You have the following Pokemons:");
            // Iterate through pokemon in party
            inventory.inventory_delta.inventory_items.forEach(function (item) {
                var pokemon = item.inventory_item_data.pokemon;
                if (pokemon) {
                    var pokedexInfo = getPokemon(pokemon.pokemon_id);
                    console.log("[i] " + pokedexInfo.name + ", CP:" + pokemon.cp);
                }
            });
        } else if (itemList === 'items') {
            
        }

        return;
    });
}

function help() {
    console.log("Available commands:");
    console.log("  init <USERNAME> <'ptc'|'google'> - Initializes client.");
    console.log("  scan - Scan for nearby Pokemons. Catchable Pokemons will contain an index to use with the catch command.");
    console.log("  scan <LATITUDE>,<LONGITUDE> - Move and scan for Pokemons at the given coordinates.");
    console.log("  catch <INDEX> - Tries to capture previously seen nearby Pokemon while scanning.");
    console.log("  profile - Displays user profile information.");
    console.log("  inventory - Displays user inventory.");
    return;
}

function getPokemon(pokedexNumber) {
    return client.pokemonlist[parseInt(pokedexNumber) - 1];
}

function getPokemonFromCell(cell) {
    var pokemon = cell.NearbyPokemon[0];
    return pokemon ? getPokemon(pokemon.PokedexNumber) : null;
}
