import React, { useState, useEffect, useRef, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged, signOut } from 'firebase/auth';
import { 
    getFirestore, 
    collection, 
    query, 
    orderBy, 
    limit, 
    onSnapshot, 
    addDoc, 
    doc, 
    setDoc, 
    updateDoc, 
    getDoc, 
    deleteDoc, 
    where,
    writeBatch 
} from 'firebase/firestore';

// --- GLOBAL VARIABLES (Provided by Canvas Environment) ---
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : '';

// --- CONFIGURATION ---
// Client ID: The unique ID for the Client user (Hardcoded for security check)
// In a real-world app, this would be retrieved securely, but for this context, 
// we assume the Client is known by a fixed ID in the system.
const HARDCODED_CLIENT_ID = "client_user_12345"; 
// Special code to reset the client message counter
const SPECIAL_CODE = "UNLOCK123"; 
// Maximum messages allowed before the special code is required
const MAX_MESSAGES_BEFORE_LOCK = 3;

// Helper to determine the Firestore path for public data
const getChatCollectionPath = (masterId, clientId) => 
    `/artifacts/${appId}/public/data/chats/${masterId}_${clientId}/messages`;

// Helper to get the status document path
const getStatusDocPath = (userId) => 
    `artifacts/${appId}/public/data/users/${userId}`;


// Function to convert Firestore Timestamp to readable time string
const formatTimestamp = (timestamp) => {
    if (!timestamp) return '...';
    const date = timestamp.toDate();
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
};

// --- Custom Modal Component (to replace alert/confirm) ---
const Modal = ({ isOpen, title, message, onClose }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-75 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 transform transition-all scale-100">
                <h3 className="text-xl font-bold text-red-600 mb-4">{title}</h3>
                <p className="text-gray-700 mb-6">{message}</p>
                <button
                    onClick={onClose}
                    className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded-lg transition duration-150"
                >
                    Close
                </button>
            </div>
        </div>
    );
};

// --- Main Application Component ---
const App = () => {
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);
    const [userRole, setUserRole] = useState(null);
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState('');
    const [clientStatus, setClientStatus] = useState({ isLoggedIn: false, msgCount: 0, forceLogout: false });
    const [loading, setLoading] = useState(true);
    const [isTouching, setIsTouching] = useState(false);
    const [modal, setModal] = useState({ isOpen: false, title: '', message: '' });
    
    const messagesEndRef = useRef(null);
    const touchTimerRef = useRef(null);

    // Master's ID is always the current user if the user is not the hardcoded client
    const masterId = userRole === 'master' ? userId : (userRole === 'client' ? userId : null);
    // Peer ID is the other user's ID
    const peerId = userRole === 'master' ? HARDCODED_CLIENT_ID : (userRole === 'client' ? masterId : null);
    
    // --- Authentication and Firebase Initialization ---
    useEffect(() => {
        const app = initializeApp(firebaseConfig);
        const authInstance = getAuth(app);
        const dbInstance = getFirestore(app);
        
        setAuth(authInstance);
        setDb(dbInstance);

        const authenticate = async () => {
            try {
                if (initialAuthToken) {
                    await signInWithCustomToken(authInstance, initialAuthToken);
                } else {
                    await signInAnonymously(authInstance);
                }
            } catch (error) {
                console.error("Firebase Auth Error:", error);
            }
        };

        const unsubscribe = onAuthStateChanged(authInstance, (user) => {
            if (user) {
                setUserId(user.uid);
                // Determine user role based on hardcoded client ID
                const role = user.uid === HARDCODED_CLIENT_ID ? 'client' : 'master';
                setUserRole(role);
            } else {
                setUserId(null);
                setUserRole(null);
            }
            setLoading(false);
        });

        authenticate();
        return () => unsubscribe();
    }, []);

    // Scroll to the latest message
    useEffect(() => {
        if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
        }
    }, [messages]);

    // --- Core Feature Implementation (Client Status, Logout, and Chat Listener) ---
    useEffect(() => {
        if (!db || !userId || !masterId) return;

        // 1. Client Status Listener (for Master and Client)
        const clientStatusDocRef = doc(db, getStatusDocPath(HARDCODED_CLIENT_ID));

        const unsubscribeStatus = onSnapshot(clientStatusDocRef, (docSnap) => {
            if (docSnap.exists()) {
                const status = docSnap.data();
                setClientStatus(status);
                
                // 7. Master One-Click Logout check for Client
                if (userRole === 'client' && status.forceLogout) {
                    // Immediately log out the client
                    handleLogout(); 
                    console.log("Master initiated forced logout.");
                }
            } else {
                // Client status doc does not exist, assume logged out or reset
                setClientStatus({ isLoggedIn: false, msgCount: 0, forceLogout: false });
            }
        }, (error) => {
            console.error("Error listening to client status:", error);
        });

        // 2. Chat Listener (for both Master and Client)
        if (userRole === 'master' && clientStatus.isLoggedIn || userRole === 'client') {
            const chatCollectionRef = collection(db, getChatCollectionPath(masterId || userId, HARDCODED_CLIENT_ID));
            const q = query(chatCollectionRef, orderBy('timestamp', 'asc'), limit(50));

            const unsubscribeChat = onSnapshot(q, (snapshot) => {
                const msgs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
                setMessages(msgs);
            }, (error) => {
                console.error("Error listening to messages:", error);
            });

            return () => {
                unsubscribeStatus();
                unsubscribeChat();
            };
        }

        return () => unsubscribeStatus();
    }, [db, userId, userRole, clientStatus.isLoggedIn]);


    // --- Status Update and Cleanup Handlers ---

    // 4. Client Login Notification (Master) & Status Update (Client)
    const handleLogin = useCallback(async () => {
        if (!db || !userId) return;

        const statusDocRef = doc(db, getStatusDocPath(userId));
        const batch = writeBatch(db);

        if (userRole === 'client') {
            // Set client status on login
            batch.set(statusDocRef, { 
                isLoggedIn: true, 
                msgCount: 0, 
                lastLogin: new Date(), 
                forceLogout: false 
            });
            // 2. Client Chat Auto-Delete on Logout (Cleanup on Login)
            // We ensure the previous client's data is cleared or start fresh.
            await deleteClientChatData(masterId, userId, db);
            console.log("Client chat data reset/deleted on successful login.");
        } else if (userRole === 'master') {
            // Master updates their own status if needed, but primarily logs in to view.
        }
        
        try {
            await batch.commit();
            console.log("Login status updated.");
        } catch(e) {
            console.error("Error during login status update:", e);
        }
    }, [db, userId, userRole, masterId]);


    // 2. Client Chat Auto-Delete Function
    const deleteClientChatData = async (mId, cId, database) => {
        if (!database || !mId || !cId) return;
        const chatPath = getChatCollectionPath(mId, cId);
        const chatCollectionRef = collection(database, chatPath);

        try {
            const docs = await getDocs(chatCollectionRef);
            if (docs.docs.length > 0) {
                const batch = writeBatch(database);
                docs.docs.forEach(doc => {
                    batch.delete(doc.ref);
                });
                await batch.commit();
            }
            // Also delete the client's main status document
            const statusDocRef = doc(database, getStatusDocPath(cId));
            await deleteDoc(statusDocRef);
        } catch (error) {
            console.error("Error deleting client chat data:", error);
        }
    };

    // Client Logout Handler
    const handleLogout = useCallback(async () => {
        if (auth) {
            await signOut(auth);
            if (db && userId === HARDCODED_CLIENT_ID) {
                // Delete chat data for the client on logout
                await deleteClientChatData(masterId || userId, userId, db); 
                console.log("Client successfully logged out and data deleted.");
            }
        }
        setUserId(null);
        setUserRole(null);
    }, [auth, db, userId, masterId]);

    // --- Message Sending Logic ---
    const handleSendMessage = async (e) => {
        e.preventDefault();
        if (!db || !userId || newMessage.trim() === '' || !masterId) return;

        const trimmedMessage = newMessage.trim();
        const chatCollectionRef = collection(db, getChatCollectionPath(masterId, HARDCODED_CLIENT_ID));
        const statusDocRef = doc(db, getStatusDocPath(HARDCODED_CLIENT_ID));

        if (userRole === 'client') {
            // 5. Client 3 Msg Limit check
            if (clientStatus.msgCount >= MAX_MESSAGES_BEFORE_LOCK) {
                setModal({ 
                    isOpen: true, 
                    title: 'Message Limit Reached', 
                    message: `आप ${MAX_MESSAGES_BEFORE_LOCK} मैसेज भेज चुके हैं। जारी रखने के लिए Master से Special Code (${SPECIAL_CODE}) भेजने को कहें।` 
                });
                return;
            }

            // 5. Special Code Check
            if (trimmedMessage.toUpperCase() === SPECIAL_CODE) {
                // Reset counter and acknowledge the code
                await setDoc(statusDocRef, { ...clientStatus, msgCount: 0 }, { merge: true });
                setNewMessage('');
                await addDoc(chatCollectionRef, {
                    text: `Master: Code received. Client message counter reset.`,
                    senderId: 'SYSTEM',
                    timestamp: new Date(),
                });
                return;
            }
        }

        const batch = writeBatch(db);

        // Add the new message
        const newMsgRef = doc(chatCollectionRef);
        batch.set(newMsgRef, {
            text: trimmedMessage,
            senderId: userId,
            timestamp: new Date(),
        });

        // Update client message count if sender is client
        if (userRole === 'client') {
            const newCount = clientStatus.msgCount + 1;
            batch.set(statusDocRef, { ...clientStatus, msgCount: newCount }, { merge: true });
        }

        try {
            await batch.commit();
            setNewMessage('');
        } catch (error) {
            setModal({ isOpen: true, title: 'Error', message: 'मैसेज भेजने में त्रुटि: ' + error.message });
        }
    };
    
    // --- Touch/Press Button Logic (Client Only) ---
    // 6. Continuous Touch/Press Logout Start
    const handleTouchStart = () => {
        if (userRole !== 'client') return;
        setIsTouching(true);
        // Start a timer for 3 seconds
        touchTimerRef.current = setTimeout(() => {
            console.log("Touch timer expired. Initiating auto-logout.");
            handleLogout();
        }, 3000); 
    };

    // 6. Continuous Touch/Press Logout End
    const handleTouchEnd = () => {
        if (userRole !== 'client') return;
        clearTimeout(touchTimerRef.current);
        setIsTouching(false);
    };

    // 7. Master Force Logout Button
    const handleMasterForceLogout = async () => {
        if (userRole !== 'master' || !db) return;
        
        try {
            const statusDocRef = doc(db, getStatusDocPath(HARDCODED_CLIENT_ID));
            await updateDoc(statusDocRef, { forceLogout: true });
            setModal({ 
                isOpen: true, 
                title: 'Client Logout Initiated', 
                message: 'Client को सफलतापूर्वक लॉगआउट करने का अनुरोध भेजा गया है। Client का डेटा डिलीट हो जाएगा।' 
            });
        } catch (error) {
            setModal({ isOpen: true, title: 'Error', message: 'Client को लॉगआउट करने में त्रुटि: ' + error.message });
        }
    };

    // --- UI Rendering ---

    if (loading) {
        return <div className="p-8 text-center text-xl font-semibold text-indigo-600">Loading...</div>;
    }

    if (!userId) {
        // Master/Client Selection before Canvas Auth takes over
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4">
                <div className="bg-white p-8 rounded-xl shadow-2xl w-full max-w-sm text-center">
                    <h1 className="text-3xl font-bold text-gray-800 mb-6">Secured Private Chat</h1>
                    <p className="text-gray-600 mb-8">Please refresh the page to authenticate. ID: {HARDCODED_CLIENT_ID} (Client) or any other ID (Master).</p>
                    <button
                        onClick={handleLogin}
                        className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 px-4 rounded-lg shadow-md transition duration-150"
                    >
                        Authenticate (Click after initial load)
                    </button>
                </div>
            </div>
        );
    }
    
    const isClientLoggedIn = clientStatus.isLoggedIn;
    const canClientSend = isClientLoggedIn && clientStatus.msgCount < MAX_MESSAGES_BEFORE_LOCK;
    
    // Master ID: Display Master's UID for identification
    const displayMasterId = userRole === 'master' ? userId : masterId;

    return (
        <div className="flex flex-col h-screen bg-gray-100 font-sans">
            <Modal
                isOpen={modal.isOpen}
                title={modal.title}
                message={modal.message}
                onClose={() => setModal({ ...modal, isOpen: false })}
            />
            
            {/* Header */}
            <header className="bg-white shadow-md p-4 flex justify-between items-center sticky top-0 z-10">
                <div className='flex flex-col'>
                    <h1 className="text-xl font-bold text-indigo-600">प्राइवेट चैट: {userRole === 'master' ? 'Master' : 'Client'}</h1>
                    <p className="text-xs text-gray-500">
                        UID: <span className="font-mono text-gray-700">{userId}</span>
                    </p>
                    {userRole === 'master' && (
                        <p className="text-xs text-red-500">
                            Client ID: <span className="font-mono text-gray-700">{HARDCODED_CLIENT_ID}</span>
                        </p>
                    )}
                </div>
                
                <div className="flex items-center space-x-3">
                    {userRole === 'master' && (
                        <span className={`px-3 py-1 text-xs rounded-full font-semibold ${isClientLoggedIn ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            Client Status: {isClientLoggedIn ? 'ऑनलाइन (Online)' : 'ऑफलाइन (Offline)'}
                        </span>
                    )}

                    <button
                        onClick={handleLogout}
                        className="bg-red-500 hover:bg-red-600 text-white text-sm font-semibold py-2 px-4 rounded-lg transition duration-150 shadow-md"
                    >
                        Logout
                    </button>
                </div>
            </header>

            {/* Master Controls & Client Status (Master Only) */}
            {userRole === 'master' && (
                <div className="p-4 bg-yellow-50 border-b border-yellow-200 flex justify-between items-center">
                    <p className="text-sm text-yellow-800 font-medium">
                        Client Messages Left: **{MAX_MESSAGES_BEFORE_LOCK - clientStatus.msgCount}** | Special Code: **{SPECIAL_CODE}**
                    </p>
                    {isClientLoggedIn && (
                        <button
                            onClick={handleMasterForceLogout}
                            className="bg-red-600 hover:bg-red-700 text-white text-sm font-semibold py-2 px-4 rounded-lg transition duration-150 shadow-lg"
                        >
                            🔴 Client को तुरंत Logout करें (Delete Data)
                        </button>
                    )}
                    {!isClientLoggedIn && (
                        <p className="text-red-600 text-sm font-semibold">Client लॉगआउट है। कोई चैट डेटा नहीं है।</p>
                    )}
                </div>
            )}
            
            {/* Master Notification on Client Login (Master Only) */}
            {userRole === 'master' && clientStatus.isLoggedIn && !clientStatus.forceLogout && (
                <div className="p-2 bg-green-100 text-center text-green-800 font-semibold animate-pulse">
                    🔔 Client ({HARDCODED_CLIENT_ID}) ने अभी-अभी Login किया है!
                </div>
            )}


            {/* Chat Area */}
            <main className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.length === 0 ? (
                    <div className="text-center text-gray-500 pt-10">
                        {isClientLoggedIn || userRole === 'master' ? 'बातचीत शुरू करें...' : 'Login करें।'}
                    </div>
                ) : (
                    messages.map((msg) => (
                        <div key={msg.id} className={`flex ${msg.senderId === userId ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-xs sm:max-w-md lg:max-w-lg p-3 rounded-xl shadow-md ${
                                msg.senderId === userId
                                    ? 'bg-indigo-600 text-white rounded-br-none'
                                    : msg.senderId === 'SYSTEM'
                                        ? 'bg-yellow-100 text-yellow-800 rounded-lg text-sm italic'
                                        : 'bg-white text-gray-800 rounded-tl-none border border-gray-200'
                            }`}>
                                <p className="text-sm break-words">{msg.text}</p>
                                <span className={`block text-xs mt-1 ${msg.senderId === userId ? 'text-indigo-200' : 'text-gray-500'}`}>
                                    {msg.senderId === userId ? 'You' : msg.senderId === 'SYSTEM' ? 'System' : 'The Other Party'} @ {formatTimestamp(msg.timestamp)}
                                </span>
                            </div>
                        </div>
                    ))
                )}
                <div ref={messagesEndRef} />
            </main>

            {/* Input and Special Button Area */}
            {userRole && isClientLoggedIn || (userRole === 'master' && isClientLoggedIn) ? (
                <footer className="bg-white p-4 shadow-2xl sticky bottom-0 z-10">
                    <form onSubmit={handleSendMessage} className="flex space-x-3">
                        {userRole === 'client' && (
                            // 6. Special Continuous Touch Button (Client Only)
                            <button
                                type="button"
                                onTouchStart={handleTouchStart}
                                onTouchEnd={handleTouchEnd}
                                onMouseDown={handleTouchStart}
                                onMouseUp={handleTouchEnd}
                                className={`flex-shrink-0 w-16 h-12 rounded-full font-bold text-white shadow-xl transition-all duration-150 ease-in-out ${
                                    isTouching ? 'bg-green-700 shadow-inner scale-105' : 'bg-green-500 hover:bg-green-600'
                                }`}
                                title="Press and Hold to prevent auto-logout. Release will log you out after 3 seconds."
                            >
                                {isTouching ? 'HOLDING' : 'TOUCH'}
                            </button>
                        )}
                        
                        <input
                            type="text"
                            value={newMessage}
                            onChange={(e) => setNewMessage(e.target.value)}
                            placeholder={userRole === 'client' && !canClientSend ? `Limit Reached. Need code: ${SPECIAL_CODE}` : 'Type your message...'}
                            className="flex-grow p-3 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 transition duration-150 disabled:bg-gray-200"
                            disabled={userRole === 'client' && !canClientSend}
                        />
                        <button
                            type="submit"
                            className={`flex-shrink-0 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 px-6 rounded-lg shadow-md transition duration-150 disabled:bg-indigo-300`}
                            disabled={userRole === 'client' && !canClientSend}
                        >
                            Send
                        </button>
                    </form>
                    {userRole === 'client' && !canClientSend && (
                        <p className="text-sm text-center text-red-500 mt-2">
                            ⚠️ मैसेज लिमिट पूरी हो गई है। जारी रखने के लिए Master से **{SPECIAL_CODE}** कोड भेजने को कहें।
                        </p>
                    )}
                    {userRole === 'client' && (
                        <p className={`text-xs text-center mt-2 ${isTouching ? 'text-green-600 font-bold' : 'text-red-500 font-bold'}`}>
                            {isTouching ? 'Touch Active: Logout Prevented' : 'Touch Inactive: If this happens for 3 seconds, you will be logged out!'}
                        </p>
                    )}
                </footer>
            ) : (
                <footer className="bg-white p-4 shadow-2xl sticky bottom-0 z-10 text-center text-red-500 font-semibold">
                    Client Logged Out. Master cannot send messages.
                    <button
                        onClick={handleLogin}
                        className="ml-4 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2 px-4 rounded-lg shadow-md transition duration-150"
                    >
                        Master Login
                    </button>
                </footer>
            )}
        </div>
    );
};

export default App;

