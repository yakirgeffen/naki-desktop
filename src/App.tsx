import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

interface ChatInfo {
  jid: string;
  name: string;
  size_bytes: number;
  last_active: number | null;
}

const formatBytes = (bytes: number) => {
  if (bytes === 0) return "0 MB";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

export default function App() {
  const [chats, setChats] = useState<ChatInfo[]>([]);
  const [selectedJids, setSelectedJids] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Modal & Processing State
  const [showModal, setShowModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    fetchChats();
  }, []);

  const fetchChats = () => {
    setLoading(true);
    invoke<ChatInfo[]>("scan_chats")
      .then((data) => {
        setChats(data);
        setSelectedJids(new Set());
        setLoading(false);
      })
      .catch((err) => {
        setError(err as string);
        setLoading(false);
      });
  };

  const toggleSelection = (jid: string) => {
    const newSet = new Set(selectedJids);
    if (newSet.has(jid)) {
      newSet.delete(jid);
    } else {
      newSet.add(jid);
    }
    setSelectedJids(newSet);
  };

  const executeDelete = async () => {
    setIsDeleting(true);
    try {
      await invoke("delete_media", { jids: Array.from(selectedJids) });
      setShowModal(false);
      fetchChats(); // Refresh the list after successful deletion
    } catch (err) {
      setError(err as string);
      setShowModal(false);
    } finally {
      setIsDeleting(false);
    }
  };

  const selectedChats = chats.filter((c) => selectedJids.has(c.jid));
  const totalSelectedBytes = selectedChats.reduce((sum, c) => sum + c.size_bytes, 0);

  if (loading && chats.length === 0) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#E8ECEF] text-[#4A4A4A]">
        <p className="text-sm font-medium drop-shadow-sm">Scanning chats...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-[#E8ECEF] text-[#4A4A4A] p-6">
        <div className="bg-white p-6 rounded-lg shadow-[0_4px_12px_rgba(0,0,0,0.1),0_1px_3px_rgba(0,0,0,0.08)] border border-[#D1D1D1]">
          <h2 className="text-lg font-bold mb-2 text-red-600 drop-shadow-sm">Error</h2>
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-[#F4F5F7] text-[#333333] font-sans selection:bg-blue-200 relative">
      
      {/* Confirmation Modal Overlay */}
      {showModal && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm">
          <div className="bg-gradient-to-b from-[#FFFFFF] to-[#EAEAEA] w-80 rounded-xl shadow-[0_10px_30px_rgba(0,0,0,0.2),0_1px_3px_rgba(0,0,0,0.1)] border border-[#C4C4C4] overflow-hidden flex flex-col">
            <div className="p-6 text-center">
              <h3 className="text-lg font-bold text-[#222] mb-2 drop-shadow-[0_1px_1px_rgba(255,255,255,0.8)]">Move to Trash?</h3>
              <p className="text-sm text-[#555] leading-relaxed">
                You are about to move media from <span className="font-semibold">{selectedJids.size} group(s)</span> to the macOS Trash. This will free up <span className="font-semibold">{formatBytes(totalSelectedBytes)}</span> of space.
              </p>
            </div>
            <div className="flex border-t border-[#C4C4C4] bg-[#F4F4F4]">
              <button 
                onClick={() => setShowModal(false)}
                disabled={isDeleting}
                className="flex-1 py-3 text-[#007AFF] font-medium border-r border-[#C4C4C4] hover:bg-[#EBEBEB] active:bg-[#DEDEDE] transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={executeDelete}
                disabled={isDeleting}
                className="flex-1 py-3 text-red-500 font-bold hover:bg-[#EBEBEB] active:bg-[#DEDEDE] transition-colors disabled:opacity-50"
              >
                {isDeleting ? "Moving..." : "Move to Trash"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Glossy Header */}
      <header className="px-6 py-3 flex justify-between items-center bg-gradient-to-b from-[#FFFFFF] to-[#EAEAEA] border-b border-[#C4C4C4] shadow-[0_1px_2px_rgba(0,0,0,0.05)] z-10">
        <h1 className="text-md font-bold text-[#333] drop-shadow-[0_1px_1px_rgba(255,255,255,0.8)]">
          Naki
        </h1>
        <span className="text-xs text-[#666] font-medium bg-[#DEDEDE] px-2 py-1 rounded-full shadow-[inset_0_1px_2px_rgba(0,0,0,0.1)] border border-[#C4C4C4]">
          {chats.length} Groups Scanned
        </span>
      </header>

      {/* Main Table Area */}
      <main className="flex-1 overflow-auto p-4 bg-[#E8ECEF] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]">
        <div className="bg-white border border-[#C4C4C4] rounded-lg shadow-[0_2px_8px_rgba(0,0,0,0.05)] overflow-hidden">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="bg-gradient-to-b from-[#F9F9F9] to-[#EFEFEF] border-b border-[#C4C4C4] text-[#555]">
                <th className="py-2 px-4 font-semibold border-r border-[#E0E0E0] w-12"></th>
                <th className="py-2 px-4 font-semibold border-r border-[#E0E0E0] drop-shadow-[0_1px_1px_rgba(255,255,255,1)]">Group Name</th>
                <th className="py-2 px-4 font-semibold drop-shadow-[0_1px_1px_rgba(255,255,255,1)]">Size</th>
              </tr>
            </thead>
            <tbody>
              {chats.map((chat, index) => {
                const isSelected = selectedJids.has(chat.jid);
                return (
                  <tr 
                    key={chat.jid} 
                    onClick={() => toggleSelection(chat.jid)}
                    className={`border-b border-[#EAEAEA] transition-colors cursor-pointer
                      ${isSelected ? 'bg-[#E3F0FF]' : (index % 2 === 0 ? 'bg-white' : 'bg-[#F9FAFB]')} 
                      hover:bg-[#E3F0FF]`
                    }
                  >
                    <td className="py-2 px-4 border-r border-[#EAEAEA] text-center">
                      <input 
                        type="checkbox" 
                        checked={isSelected}
                        onChange={() => {}} // Handled by tr onClick
                        className="appearance-none w-4 h-4 bg-gradient-to-b from-[#F2F2F2] to-[#E0E0E0] border border-[#A0A0A0] rounded shadow-[inset_0_1px_2px_rgba(0,0,0,0.1)] 
                                   checked:bg-gradient-to-b checked:from-[#5698F5] checked:to-[#2D75E8] checked:border-[#1C5ECA] checked:shadow-[inset_0_1px_2px_rgba(0,0,0,0.2)]
                                   cursor-pointer relative align-middle pointer-events-none
                                   checked:after:content-['✓'] checked:after:absolute checked:after:text-white checked:after:font-bold checked:after:text-xs checked:after:left-[2px] checked:after:-top-[1px]" 
                      />
                    </td>
                    <td className="py-2 px-4 border-r border-[#EAEAEA] font-medium text-[#222]">
                      {chat.name}
                    </td>
                    <td className="py-2 px-4 text-[#555] font-medium">
                      {formatBytes(chat.size_bytes)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </main>

      {/* Footer */}
      <footer className="px-6 py-4 flex justify-between items-center bg-gradient-to-b from-[#EAEAEA] to-[#D4D4D4] border-t border-[#B0B0B0] shadow-[0_-1px_2px_rgba(0,0,0,0.05)] z-10">
        <div className="text-sm text-[#444] font-medium drop-shadow-[0_1px_1px_rgba(255,255,255,0.6)]">
          {selectedJids.size > 0 
            ? <span className="font-bold text-[#222]">{selectedJids.size} groups selected • {formatBytes(totalSelectedBytes)}</span>
            : "0 groups selected"
          }
        </div>
        <button 
          onClick={() => setShowModal(true)}
          disabled={selectedJids.size === 0}
          className="bg-gradient-to-b from-[#6EB0FF] to-[#1C75E8] border border-[#1150A6] 
                     shadow-[0_1px_2px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.4)] 
                     text-white px-5 py-1.5 rounded-md text-sm font-semibold tracking-wide
                     active:from-[#1C75E8] active:to-[#1150A6] active:shadow-[inset_0_2px_3px_rgba(0,0,0,0.3)]
                     disabled:from-[#A8C7FA] disabled:to-[#74A3ED] disabled:border-[#6B93D6] disabled:text-[#E2EEFF] disabled:cursor-not-allowed
                     transition-all duration-75"
        >
          Clear selected media
        </button>
      </footer>
    </div>
  );
}