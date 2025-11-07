// Firebase configuration (Replace 'YOUR-PROJECT-ID' with your actual Firebase Project ID)
const firebaseConfig = {
  apiKey: "YOUR-API-KEY", // Replace with your actual API Key
  authDomain: "YOUR-PROJECT-ID.firebaseapp.com",
  projectId: "YOUR-PROJECT-ID", // <-- Replace this
  storageBucket: "YOUR-PROJECT-ID.appspot.com",
  messagingSenderId: "YOUR-MESSAGING-SENDER-ID",
  appId: "YOUR-APP-ID"
};

// Initialize Firebase
const app = firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

// Use React hooks
const { useState, useEffect, useRef } = React;

// --- Main Chat Component ---
function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [user, setUser] = useState(null);
  const messagesEndRef = useRef(null);

  // Scroll to the latest message
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // 1. Authentication Listener
  useEffect(() => {
    // Sign in anonymously for simplicity if no user is signed in
    const unsubscribe = auth.onAuthStateChanged(currentUser => {
      if (currentUser) {
        setUser(currentUser);
      } else {
        // Sign in anonymously if not authenticated
        auth.signInAnonymously().catch(error => {
          console.error("Anonymous Sign In failed:", error);
        });
      }
    });

    return unsubscribe;
  }, []);

  // 2. Real-time Firestore Listener
  useEffect(() => {
    if (!user) return; // Wait until user is authenticated

    const q = db.collection('chats')
      .orderBy('timestamp', 'asc'); // Sort by time

    const unsubscribe = q.onSnapshot(snapshot => {
      const newMessages = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setMessages(newMessages);
    }, error => {
      console.error("Error fetching chat messages:", error);
    });

    return unsubscribe; // Cleanup listener on unmount
  }, [user]);

  // 3. Scroll after messages are loaded
  useEffect(scrollToBottom, [messages]);


  // Function to send a message
  const sendMessage = async (e) => {
    e.preventDefault();
    if (input.trim() === '' || !user) return;

    try {
      await db.collection('chats').add({
        text: input,
        timestamp: firebase.firestore.FieldValue.serverTimestamp(), // Use server time
        uid: user.uid,
        displayName: `Guest-${user.uid.substring(0, 4)}`, // Simple anonymous name
      });
      setInput('');
    } catch (error) {
      console.error("Error sending message:", error);
    }
  };

  // The main UI (The part you had in your original JS file)
  return (
    <div className="flex flex-col h-screen bg-gray-100 font-sans">
      
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 p-4 bg-white shadow-md z-10">
        <h1 className="text-2xl font-bold text-indigo-600">
          Private Chat (Firebase)
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          {user ? `Logged in as: Guest-${user.uid.substring(0, 4)}` : 'Authenticating...'}
        </p>
      </header>

      {/* Messages Area */}
      <main className="flex-1 overflow-y-auto pt-24 pb-20 p-4 chat-container">
        {messages.length === 0 && (
          <p className="text-center text-gray-500 mt-10">Start the conversation!</p>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`flex mb-4 ${msg.uid === user?.uid ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-xs lg:max-w-md px-4 py-2 rounded-xl shadow ${
              msg.uid === user?.uid 
                ? 'bg-indigo-500 text-white rounded-br-none' 
                : 'bg-white text-gray-800 rounded-tl-none border border-gray-200'
            }`}>
              <p className="font-semibold text-xs mb-1 opacity-70">
                {msg.displayName || 'Anonymous'}
              </p>
              <p>{msg.text}</p>
              <span className="text-xs mt-1 block text-right opacity-60">
                {msg.timestamp?.toDate ? new Date(msg.timestamp.toDate()).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '...'}
              </span>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </main>

      {/* Input Form */}
      <footer className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-gray-200 z-10">
        <form onSubmit={sendMessage} className="flex space-x-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition duration-150"
            disabled={!user}
          />
          <button
            type="submit"
            className={`p-3 rounded-xl text-white font-semibold transition duration-150 shadow-lg ${
              input.trim() ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-indigo-400 cursor-not-allowed'
            }`}
            disabled={!input.trim() || !user}
          >
            Send
          </button>
        </form>
      </footer>
    </div>
  );
}

// Render the main component into the root element
ReactDOM.render(<App />, document.getElementById('root'));