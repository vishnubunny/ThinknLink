const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "http://localhost:3000",
        methods: ["GET", "POST"]
    }
});

const wordList = [
    "Dog", "Car", "Tree", "Book", "Phone", "Table", "Water", "Light",
    "Chair", "House", "Clock", "Road", "Paper", "Shoe", "Laptop", "Bag",
    "School", "Rain", "Sun", "Door", "Glass", "Ball", "Flower", "Bed",
    "Window", "Bridge", "Bottle", "Camera", "Watch", "Pencil", "Fire",
    "Train", "River", "Mountain", "Keyboard", "Mouse", "Speaker", "Hat",
    "Jacket", "Mirror", "Fence", "Cloud", "Sky", "Ocean", "Toothbrush"
];

let rooms = {};


const getRandomWords = () => {
    let firstIndex = Math.floor(Math.random() * wordList.length);
    let secondIndex;
    do {
        secondIndex = Math.floor(Math.random() * wordList.length);
    } while (secondIndex === firstIndex);
    return [wordList[firstIndex], wordList[secondIndex]];
};

io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("create-room", ({ roomId, username }) => {
        rooms[roomId] = { 
            players: {}, 
            submissions: [], 
            creator: socket.id, 
            rounds: 1, 
            currentRound: 0,
            gameStarted: false,
            timerStarted: false,
            words: [],
            chat: [],
            timer: null
        };

        rooms[roomId].players[socket.id] = username;
        socket.join(roomId);

        io.to(roomId).emit("update-players", Object.values(rooms[roomId].players));
        io.to(roomId).emit("update-rounds", { rounds: rooms[roomId].rounds, creator: rooms[roomId].creator });
        io.to(socket.id).emit("chat-history", rooms[roomId].chat);
    });

    socket.on("join-room", ({ roomId, username }, callback) => {
        if (!rooms[roomId]) {
            if (typeof callback === "function") {
                callback({ success: false, message: "Invalid Room ID! Room does not exist." });
            }
            return;
        }

        rooms[roomId].players[socket.id] = username;
        socket.join(roomId);

        io.to(roomId).emit("update-players", Object.values(rooms[roomId].players));
        io.to(roomId).emit("update-rounds", { rounds: rooms[roomId].rounds, creator: rooms[roomId].creator });
        io.to(socket.id).emit("chat-history", rooms[roomId].chat);

        if (typeof callback === "function") {
            callback({ success: true });
        }
    });

    socket.on("send-chat-message", ({ roomId, username, message }) => {
        if (!rooms[roomId]) return;

        const chatMessage = { username, message, timestamp: new Date().toLocaleTimeString() };
        rooms[roomId].chat.push(chatMessage);  // Store message in chat history

        io.to(roomId).emit("receive-chat-message", chatMessage);
    });

    socket.on("set-rounds", ({ roomId, rounds }) => {
        if (rooms[roomId] && socket.id === rooms[roomId].creator) {
            rooms[roomId].rounds = rounds;
            io.to(roomId).emit("update-rounds", { rounds: rooms[roomId].rounds, creator: rooms[roomId].creator });
        }
    });

    socket.on("start-game", ({ roomId }) => {
        if (rooms[roomId] && socket.id === rooms[roomId].creator) {
            rooms[roomId].currentRound = 1;
            rooms[roomId].gameStarted = true;
            rooms[roomId].words = getRandomWords();
            rooms[roomId].submissions = [];
            rooms[roomId].timerStarted = false;
            io.to(roomId).emit("game-started", rooms[roomId].words);
        }
    });

    socket.on("submit-chain", ({ roomId, username, chain }) => {
        if (!rooms[roomId]) return;

        // Add the submission if it does not already exist
        const existingSubmission = rooms[roomId].submissions.find(sub => sub.username === username);
        if (!existingSubmission) {
            rooms[roomId].submissions.push({ username, chain });
        }

        // Start the timer only once per round
        if (!rooms[roomId].timerStarted) {
            rooms[roomId].timerStarted = true;
            let countdown = 10;  // Set to 30 in production

            io.to(roomId).emit("start-timer", countdown);

            const timer = setInterval(() => {
                countdown--;
                io.to(roomId).emit("start-timer", countdown);

                if (countdown === 0 || rooms[roomId].submissions.length === Object.keys(rooms[roomId].players).length) {
                    clearInterval(timer);

                    // Auto-generate missing submissions
                    Object.keys(rooms[roomId].players).forEach((playerId) => {
                        const username = rooms[roomId].players[playerId];

                        if (!rooms[roomId].submissions.some(sub => sub.username === username)) {
                            rooms[roomId].submissions.push({
                                username,
                                chain: ["No Submission"]
                            });
                        }
                    });

                    // Send results to all players
                    io.to(roomId).emit("results", rooms[roomId].submissions);
                    io.to(roomId).emit("results-players", Object.values(rooms[roomId].players));

                    // End game after showing results
                    setTimeout(() => {
                        io.to(roomId).emit("game-over");
                    }, 5000);
                }
            }, 1000);
        }
    });

    socket.on("get-results", ({ roomId }) => {
        if (rooms[roomId]) {
            io.to(socket.id).emit("results", rooms[roomId].submissions);
        }
    });



    socket.on("vote", ({ roomId, votedChain, username }) => {
        if (!rooms[roomId]) return;
    
        if (!rooms[roomId].votes) rooms[roomId].votes = {};
        if (!rooms[roomId].userVotes) rooms[roomId].userVotes = {};
        if (!rooms[roomId].playersVoted) rooms[roomId].playersVoted = new Set();
        if (!rooms[roomId].userScores) rooms[roomId].userScores = {};
        rooms[roomId].userScores = {};

    
        // Store vote count
        if (!rooms[roomId].votes[votedChain]) {
            rooms[roomId].votes[votedChain] = 0;
        }
        rooms[roomId].votes[votedChain]++;

        //User Scores
        if (!rooms[roomId].userScores[username]) {
            rooms[roomId].userScores[username] = 0;
        }
    
       


    
        // Track who voted whom
        if (!rooms[roomId].userVotes[votedChain]) {
            rooms[roomId].userVotes[votedChain] = [];
        }
        rooms[roomId].userVotes[votedChain].push(username);
    
        // Mark the player as voted
        rooms[roomId].playersVoted.add(username);
    
        io.to(roomId).emit("vote-update", rooms[roomId].votes);

        console.log("votes: ", rooms[roomId].votes);
        console.log("uservotes: ", rooms[roomId].userVotes);
        console.log("playersvoted: ", rooms[roomId].playersVoted);

    
        // **Only reveal votes once every player has voted**
        if (rooms[roomId].playersVoted.size === Object.keys(rooms[roomId].players).length) {

            

            const scoreMap = {};
            rooms[roomId].submissions.forEach(item => {
            scoreMap[item.username] = rooms[roomId].votes[item.chain] || 0;
            });

            rooms[roomId].userScores = scoreMap;
           
            
            
            console.log(rooms[roomId].userScores);


            io.to(roomId).emit("reveal-votes", rooms[roomId].userVotes, rooms[roomId].userScores);
        }
    });

    socket.on("disconnect", () => {
        console.log("User disconnected:", socket.id);
        for (const roomId in rooms) {
            if (rooms[roomId].players[socket.id]) {
                delete rooms[roomId].players[socket.id];
                if (Object.keys(rooms[roomId].players).length === 0) {
                    delete rooms[roomId];
                } else {
                    io.to(roomId).emit("update-players", Object.values(rooms[roomId].players));
                }
            }
        }
    });
});

server.listen(5001, () => {
    console.log("Server running on port 5001");
});




