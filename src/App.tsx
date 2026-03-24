import * as React from "react";
import { useState, useEffect } from "react";
import { Upload, Search, FileText, Filter, Loader2, CheckCircle, AlertCircle, Calendar, Building2, LogIn, LogOut, User, Printer, Smartphone, Folder, FolderPlus, ChevronRight, MoreVertical, Trash2, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { GoogleGenAI } from "@google/genai";
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut, 
  User as FirebaseUser 
} from "firebase/auth";
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  addDoc, 
  orderBy, 
  onSnapshot,
  Timestamp,
  getDocFromServer,
  doc,
  getDoc,
  setDoc,
  deleteDoc
} from "firebase/firestore";
import { auth, db } from "./firebase";

declare global {
  interface Window {
    aistudio: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

// --- Error Handling ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

class ErrorBoundary extends React.Component<any, any> {
  constructor(props: any) {
    super(props);
    (this as any).state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    const self = this as any;
    if (self.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-red-50 p-4">
          <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center">
            <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Ops! Algo deu errado.</h1>
            <p className="text-gray-600 mb-6">Ocorreu um erro inesperado na aplicação.</p>
            <div className="bg-gray-100 p-4 rounded-lg text-left text-xs font-mono overflow-auto max-h-40 mb-6">
              {self.state.error?.message}
            </div>
            <button 
              onClick={() => window.location.reload()}
              className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 transition-all"
            >
              Recarregar Página
            </button>
          </div>
        </div>
      );
    }

    return self.props.children;
  }
}

// --- App Logic ---

interface Documento {
  id: string;
  id_unico: string;
  titulo: string;
  data_emissao: string;
  tipo_documento: string;
  secretaria_origem: string;
  status: string;
  arquivo_url: string;
  snippet?: string;
  conteudo_ocr?: string;
  uid: string;
  pasta_id?: string;
}

interface Pasta {
  id: string;
  nome: string;
  uid: string;
  parent_id?: string;
  data_criacao: string;
}

function DMSApp() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [secretaria, setSecretaria] = useState("");
  const [tipo, setTipo] = useState("");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [results, setResults] = useState<Documento[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isScanSnapConnected, setIsScanSnapConnected] = useState(false);
  const [isManualConnecting, setIsManualConnecting] = useState(false);
  const [manualScannerId, setManualScannerId] = useState("");
  const [hasApiKey, setHasApiKey] = useState(true);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const [pastaError, setPastaError] = useState<string | null>(null);

  // Pastas
  const [pastas, setPastas] = useState<Pasta[]>([]);
  const [selectedPastaId, setSelectedPastaId] = useState<string | null>(null);
  const [isCreatingPasta, setIsCreatingPasta] = useState(false);
  const [newPastaName, setNewPastaName] = useState("");
  const [pastaToDelete, setPastaToDelete] = useState<string | null>(null);
  const [creatingSubPastaForId, setCreatingSubPastaForId] = useState<string | null>(null);
  const [selectedDocForPreview, setSelectedDocForPreview] = useState<Documento | null>(null);

  // Form de Upload
  const [uploadForm, setUploadForm] = useState({
    titulo: "",
    data_emissao: "",
    tipo_documento: "Contrato",
    secretaria_origem: "Saúde",
    pasta_id: "",
    file: null as File | null
  });

  // Check for API Key
  useEffect(() => {
    const checkKey = async () => {
      if (window.aistudio && typeof window.aistudio.hasSelectedApiKey === 'function') {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        setHasApiKey(hasKey);
      }
    };
    checkKey();
  }, []);

  const handleOpenKeyDialog = async () => {
    if (window.aistudio && typeof window.aistudio.openSelectKey === 'function') {
      await window.aistudio.openSelectKey();
      setHasApiKey(true);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Fetch Pastas
  useEffect(() => {
    if (isAuthReady && user) {
      const q = query(collection(db, 'pastas'), where('uid', '==', user.uid), orderBy('data_criacao', 'desc'));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const pastasData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Pasta));
        setPastas(pastasData);
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'pastas');
      });
      return () => unsubscribe();
    }
  }, [isAuthReady, user]);

  // Fetch Documents
  useEffect(() => {
    if (isAuthReady && user) {
      handleSearch();
    }
  }, [isAuthReady, user, selectedPastaId, secretaria, tipo, dataInicio, dataFim]);

  // Test Firestore Connection
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    }
    if (isAuthReady && user) testConnection();
  }, [isAuthReady, user]);

  const handleLogin = async () => {
    setLoginError(null);
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      console.error("Erro no login:", error);
      if (error.code === 'auth/popup-blocked') {
        setLoginError("O popup de login foi bloqueado pelo navegador. Por favor, permita popups para este site.");
      } else if (error.code === 'auth/unauthorized-domain') {
        setLoginError("Este domínio não está autorizado para login no Firebase. Por favor, verifique as configurações do console do Firebase.");
      } else {
        setLoginError(`Erro ao entrar com Google: ${error.message}`);
      }
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Erro no logout:", error);
    }
  };

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!isAuthReady || !user) return;
    
    setIsSearching(true);
    const path = 'documentos';
    try {
      let q = query(collection(db, path), where("uid", "==", user.uid), orderBy("data_upload", "desc"));

      if (selectedPastaId) {
        q = query(q, where("pasta_id", "==", selectedPastaId));
      }
      if (secretaria) {
        q = query(q, where("secretaria_origem", "==", secretaria));
      }
      if (tipo) {
        q = query(q, where("tipo_documento", "==", tipo));
      }
      
      const querySnapshot = await getDocs(q);
      const docs = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Documento[];

      // Client-side filtering for text search
      const filteredDocs = docs.filter(doc => {
        const searchLower = searchQuery.toLowerCase();
        const matchesText = !searchQuery || 
          doc.titulo.toLowerCase().includes(searchLower) || 
          doc.conteudo_ocr?.toLowerCase().includes(searchLower);
        
        const matchesDateInicio = !dataInicio || doc.data_emissao >= dataInicio;
        const matchesDateFim = !dataFim || doc.data_emissao <= dataFim;

        return matchesText && matchesDateInicio && matchesDateFim;
      });

      // Add snippets for search matches
      const resultsWithSnippets = filteredDocs.map(doc => {
        if (searchQuery && doc.conteudo_ocr) {
          const index = doc.conteudo_ocr.toLowerCase().indexOf(searchQuery.toLowerCase());
          if (index !== -1) {
            const start = Math.max(0, index - 40);
            const end = Math.min(doc.conteudo_ocr.length, index + 60);
            const snippetText = doc.conteudo_ocr.substring(start, end);
            const highlighted = snippetText.replace(new RegExp(searchQuery, 'gi'), (match) => `<b>${match}</b>`);
            return { ...doc, snippet: highlighted };
          }
        }
        return doc;
      });

      setResults(resultsWithSnippets);
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, path);
    } finally {
      setIsSearching(false);
    }
  };

  const handleCreatePasta = async (e: React.FormEvent, parentId?: string) => {
    e.preventDefault();
    if (!user || !newPastaName.trim()) return;

    try {
      await addDoc(collection(db, 'pastas'), {
        nome: newPastaName,
        uid: user.uid,
        parent_id: parentId || null,
        data_criacao: new Date().toISOString()
      });
      setNewPastaName("");
      setIsCreatingPasta(false);
      setCreatingSubPastaForId(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'pastas');
    }
  };

  const handleDeletePasta = async (pastaId: string) => {
    if (!user) return;
    setPastaError(null);
    try {
      await deleteDoc(doc(db, 'pastas', pastaId));
      if (selectedPastaId === pastaId) setSelectedPastaId(null);
      setPastaToDelete(null);
    } catch (error: any) {
      console.error("Erro ao excluir pasta:", error);
      setPastaError("Não foi possível excluir a pasta. Verifique suas permissões.");
      // Don't throw here to avoid crashing the UI, just show the error
      setPastaToDelete(null);
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadForm.file || !user) return;

    setIsUploading(true);
    setUploadStatus(null);

    try {
      // 1. Upload file to local server to get a URL (simulating storage)
      const formData = new FormData();
      formData.append("pdf", uploadForm.file);
      
      const uploadResponse = await fetch("/api/upload", {
        method: "POST",
        body: formData
      });
      
      if (!uploadResponse.ok) throw new Error("Falha no upload do arquivo físico");
      const { filePath } = await uploadResponse.json();

      // 2. Perform OCR using Gemini on the frontend
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve) => {
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1];
          resolve(base64);
        };
        reader.readAsDataURL(uploadForm.file!);
      });

      const base64Data = await base64Promise;

      // Initialize Gemini right before use
      const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || "";
      if (!apiKey && !hasApiKey) {
        setUploadStatus({ type: 'error', message: "Chave de API não configurada. Por favor, selecione uma chave." });
        setIsUploading(false);
        return;
      }

      const ai = new GoogleGenAI({ apiKey });
      const ocrResponse = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            parts: [
              { text: "Extraia todo o texto deste documento PDF digitalizado de forma fiel e completa. Se houver tabelas, tente manter a estrutura básica." },
              { inlineData: { data: base64Data, mimeType: "application/pdf" } }
            ]
          }
        ]
      });

      const extractedText = ocrResponse.text || "";

      // 3. Save metadata to Firestore
      const path = 'documentos';
      await addDoc(collection(db, path), {
        titulo: uploadForm.titulo,
        data_emissao: uploadForm.data_emissao,
        data_upload: new Date().toISOString(),
        tipo_documento: uploadForm.tipo_documento,
        secretaria_origem: uploadForm.secretaria_origem,
        pasta_id: uploadForm.pasta_id || null,
        status: "concluido",
        arquivo_url: filePath,
        conteudo_ocr: extractedText,
        uid: user.uid
      });

      setUploadStatus({ type: 'success', message: "Documento processado e salvo com sucesso!" });
      setUploadForm({ titulo: "", data_emissao: "", tipo_documento: "Contrato", secretaria_origem: "Saúde", file: null });
      handleSearch();
    } catch (error) {
      console.error("Erro no upload/OCR:", error);
      setUploadStatus({ type: 'error', message: "Erro ao processar documento." });
    } finally {
      setIsUploading(false);
    }
  };

  useEffect(() => {
    if (isAuthReady && user) {
      handleSearch();
      checkScanSnapStatus();
    }
  }, [isAuthReady, user]);

  const checkScanSnapStatus = async () => {
    if (!user) return;
    const path = `scansnap_configs/${user.uid}`;
    try {
      const configDoc = await getDoc(doc(db, 'scansnap_configs', user.uid));
      if (configDoc.exists()) {
        setIsScanSnapConnected(configDoc.data().is_connected);
      }
    } catch (error) {
      console.error("Erro ao verificar status do ScanSnap:", error);
      handleFirestoreError(error, OperationType.GET, path);
    }
  };

  const handleConnectScanSnap = () => {
    // Abre o popup de autenticação do ScanSnap
    const width = 600;
    const height = 700;
    const left = window.screenX + (window.innerWidth - width) / 2;
    const top = window.screenY + (window.innerHeight - height) / 2;
    
    window.open(
      '/api/scansnap/auth',
      'scansnap_auth',
      `width=${width},height=${height},left=${left},top=${top}`
    );
    
    // Simula conexão para fins de demonstração
    setTimeout(async () => {
      if (user) {
        await setDoc(doc(db, 'scansnap_configs', user.uid), {
          uid: user.uid,
          is_connected: true,
          updated_at: new Date().toISOString()
        });
        setIsScanSnapConnected(true);
      }
    }, 5000);
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-12 h-12 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="bg-white p-10 rounded-3xl shadow-2xl max-w-md w-full text-center border border-gray-100">
          <div className="bg-blue-600 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-blue-200">
            <FileText className="text-white w-8 h-8" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">DMS Prefeitura</h1>
          <p className="text-gray-500 mb-8">Gestão Inteligente de Documentos Digitalizados. Faça login para acessar o sistema.</p>
          <button 
            onClick={handleLogin}
            className="w-full bg-white border-2 border-gray-200 text-gray-700 py-4 rounded-2xl font-bold hover:bg-gray-50 transition-all flex items-center justify-center gap-3 shadow-sm active:scale-95"
          >
            <LogIn className="w-5 h-5 text-blue-600" />
            Entrar com Google
          </button>

          {loginError && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-6 p-4 bg-red-50 border border-red-100 rounded-xl flex items-center gap-3 text-left"
            >
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
              <p className="text-xs text-red-700 font-medium leading-relaxed">{loginError}</p>
            </motion.div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#212529] font-sans pb-20">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 py-6 px-8 sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-lg">
              <FileText className="text-white w-6 h-6" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">
              DMS <span className="text-blue-600">Prefeitura</span>
            </h1>
          </div>
          
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3 bg-gray-50 px-4 py-2 rounded-full border border-gray-100">
              {user.photoURL ? (
                <img src={user.photoURL} alt={user.displayName || ""} className="w-8 h-8 rounded-full border border-white shadow-sm" referrerPolicy="no-referrer" />
              ) : (
                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                  <User className="w-4 h-4 text-blue-600" />
                </div>
              )}
              <div className="hidden sm:block">
                <p className="text-xs font-bold text-gray-900 leading-none">{user.displayName}</p>
                <p className="text-[10px] text-gray-500 mt-0.5">{user.email}</p>
              </div>
              <button 
                onClick={handleLogout}
                className="p-1.5 hover:bg-red-50 rounded-full transition-colors text-gray-400 hover:text-red-500"
                title="Sair"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Sidebar: Upload & Filtros */}
        <aside className="lg:col-span-4 space-y-8">
          
          {/* Pastas Section */}
          <section className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Folder className="w-5 h-5 text-blue-600" />
                Pastas
              </h2>
              <button 
                onClick={() => setIsCreatingPasta(!isCreatingPasta)}
                className="p-1.5 hover:bg-blue-50 rounded-lg text-blue-600 transition-colors"
                title="Nova Pasta"
              >
                <FolderPlus className="w-5 h-5" />
              </button>
            </div>

            {isCreatingPasta && (
              <motion.form 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                onSubmit={handleCreatePasta}
                className="mb-4 space-y-2"
              >
                <input 
                  type="text"
                  autoFocus
                  placeholder="Nome da pasta..."
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  value={newPastaName}
                  onChange={e => setNewPastaName(e.target.value)}
                />
                <div className="flex gap-2">
                  <button type="submit" className="flex-1 bg-blue-600 text-white text-xs font-bold py-2 rounded-lg">Criar</button>
                  <button type="button" onClick={() => setIsCreatingPasta(false)} className="flex-1 bg-gray-100 text-gray-500 text-xs font-bold py-2 rounded-lg">Cancelar</button>
                </div>
              </motion.form>
            )}

            {pastaError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-xl flex items-center gap-2 text-red-600 text-xs">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <p>{pastaError}</p>
                <button onClick={() => setPastaError(null)} className="ml-auto font-bold">OK</button>
              </div>
            )}

            <div className="space-y-1">
              <button 
                onClick={() => setSelectedPastaId(null)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm font-medium transition-all ${!selectedPastaId ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}
              >
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Todos os Documentos
                </div>
              </button>

              {/* Renderização Recursiva de Pastas */}
              {(() => {
                const renderFolders = (parentId: string | null = null, level = 0) => {
                  return pastas
                    .filter(p => (p.parent_id || null) === parentId)
                    .map(pasta => (
                      <div key={pasta.id} className="space-y-1">
                        <div className="group relative" style={{ marginLeft: `${level * 12}px` }}>
                          <button 
                            onClick={() => setSelectedPastaId(pasta.id)}
                            className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm font-medium transition-all ${selectedPastaId === pasta.id ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}
                          >
                            <div className="flex items-center gap-2 overflow-hidden">
                              <Folder className="w-4 h-4 shrink-0" />
                              <span className="truncate">{pasta.nome}</span>
                            </div>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setCreatingSubPastaForId(pasta.id);
                                  setIsCreatingPasta(false);
                                }}
                                className="p-1 hover:bg-blue-100 rounded text-blue-600"
                                title="Nova Subpasta"
                              >
                                <FolderPlus className="w-3 h-3" />
                              </button>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPastaToDelete(pasta.id);
                                }}
                                className="p-1 hover:bg-red-50 rounded text-red-400"
                                title="Excluir"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </button>

                          {pastaToDelete === pasta.id && (
                            <div className="absolute inset-0 bg-white/95 flex items-center justify-center gap-2 z-10 rounded-xl px-2">
                              <p className="text-[10px] font-bold text-gray-500">Excluir?</p>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeletePasta(pasta.id);
                                }}
                                className="bg-red-500 text-white text-[10px] px-2 py-1 rounded font-bold"
                              >
                                Sim
                              </button>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPastaToDelete(null);
                                }}
                                className="bg-gray-100 text-gray-500 text-[10px] px-2 py-1 rounded font-bold"
                              >
                                Não
                              </button>
                            </div>
                          )}
                        </div>

                        {creatingSubPastaForId === pasta.id && (
                          <motion.form 
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            onSubmit={(e) => handleCreatePasta(e, pasta.id)}
                            className="mb-2 space-y-2 px-3"
                            style={{ marginLeft: `${(level + 1) * 12}px` }}
                          >
                            <input 
                              type="text"
                              autoFocus
                              placeholder="Nome da subpasta..."
                              className="w-full px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-blue-500"
                              value={newPastaName}
                              onChange={e => setNewPastaName(e.target.value)}
                            />
                            <div className="flex gap-2">
                              <button type="submit" className="flex-1 bg-blue-600 text-white text-[10px] font-bold py-1.5 rounded-lg">Criar</button>
                              <button type="button" onClick={() => setCreatingSubPastaForId(null)} className="flex-1 bg-gray-100 text-gray-500 text-[10px] font-bold py-1.5 rounded-lg">Cancelar</button>
                            </div>
                          </motion.form>
                        )}

                        {renderFolders(pasta.id, level + 1)}
                      </div>
                    ));
                };
                return renderFolders();
              })()}
            </div>
          </section>

          {/* ScanSnap Integration */}
          <section className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm overflow-hidden relative group">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <Printer className="w-12 h-12 text-blue-600" />
            </div>
            
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Printer className="w-5 h-5 text-blue-600" />
              ScanSnap
            </h2>

            {!isScanSnapConnected ? (
              <div className="space-y-4">
                <p className="text-sm text-gray-500 leading-relaxed">
                  Digitalize documentos diretamente para o sistema usando o seu scanner ScanSnap.
                </p>
                
                {!isManualConnecting ? (
                  <div className="space-y-3">
                    <button 
                      onClick={handleConnectScanSnap}
                      className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-200 flex items-center justify-center gap-3 active:scale-95"
                    >
                      <Smartphone className="w-4 h-4" />
                      Conectar Scanner
                    </button>
                    <button 
                      onClick={() => setIsManualConnecting(true)}
                      className="w-full bg-white border border-gray-200 text-gray-600 py-2 rounded-xl text-xs font-bold hover:bg-gray-50 transition-all"
                    >
                      Conectar Manualmente
                    </button>
                  </div>
                ) : (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-3 p-4 bg-gray-50 rounded-xl border border-gray-100"
                  >
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400">Número de Série / IP</label>
                    <input 
                      type="text"
                      placeholder="Ex: SN-12345678"
                      className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                      value={manualScannerId}
                      onChange={e => setManualScannerId(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <button 
                        onClick={() => {
                          if (manualScannerId.trim()) {
                            setIsScanSnapConnected(true);
                            setIsManualConnecting(false);
                            setManualScannerId("");
                          }
                        }}
                        className="flex-1 bg-blue-600 text-white text-xs font-bold py-2 rounded-lg"
                      >
                        Confirmar
                      </button>
                      <button 
                        onClick={() => setIsManualConnecting(false)}
                        className="flex-1 bg-gray-200 text-gray-600 text-xs font-bold py-2 rounded-lg"
                      >
                        Voltar
                      </button>
                    </div>
                  </motion.div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-green-50 p-4 rounded-xl border border-green-100 flex items-center gap-3">
                  <div className="bg-green-500 p-1 rounded-full">
                    <CheckCircle className="text-white w-2.5 h-2.5" />
                  </div>
                  <p className="text-sm font-bold text-green-700">Scanner Conectado</p>
                </div>
                <p className="text-[10px] text-gray-400 text-center">
                  Pronto para digitalização direta via ScanSnap Cloud.
                </p>
                <button 
                  onClick={() => setIsScanSnapConnected(false)}
                  className="w-full bg-gray-50 text-gray-400 py-2 rounded-lg text-xs font-bold hover:bg-red-50 hover:text-red-500 transition-all"
                >
                  Desconectar
                </button>
              </div>
            )}
          </section>

          {/* Card de Upload */}
          <section className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Upload className="w-5 h-5 text-blue-600" />
              Novo Documento (Scan)
            </h2>

            {!hasApiKey && (
              <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                <p className="text-xs text-amber-700 mb-3 font-medium">
                  Para utilizar o OCR (reconhecimento de texto), é necessário configurar uma chave de API do Gemini.
                </p>
                <button 
                  onClick={handleOpenKeyDialog}
                  className="w-full bg-amber-600 text-white py-2 rounded-lg text-xs font-bold hover:bg-amber-700 transition-all"
                >
                  Configurar Chave API
                </button>
                <p className="mt-2 text-[10px] text-amber-600 text-center">
                  <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noopener noreferrer" className="underline">Saiba mais sobre faturamento</a>
                </p>
              </div>
            )}

            <form onSubmit={handleUpload} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-400 mb-1">Título</label>
                <input 
                  type="text" 
                  required
                  className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                  placeholder="Ex: Contrato de Asfalto 2024"
                  value={uploadForm.titulo}
                  onChange={e => setUploadForm({...uploadForm, titulo: e.target.value})}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-gray-400 mb-1">Tipo</label>
                  <select 
                    className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg outline-none"
                    value={uploadForm.tipo_documento}
                    onChange={e => setUploadForm({...uploadForm, tipo_documento: e.target.value})}
                  >
                    <option>Contrato</option>
                    <option>Decreto</option>
                    <option>Portaria</option>
                    <option>Ofício</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-gray-400 mb-1">Pasta</label>
                  <select 
                    className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg outline-none"
                    value={uploadForm.pasta_id}
                    onChange={e => setUploadForm({...uploadForm, pasta_id: e.target.value})}
                  >
                    <option value="">Nenhuma</option>
                    {(() => {
                      const renderOptions = (parentId: string | null = null, level = 0) => {
                        return pastas
                          .filter(p => (p.parent_id || null) === parentId)
                          .map(p => (
                            <React.Fragment key={p.id}>
                              <option value={p.id}>
                                {"\u00A0".repeat(level * 4)}{p.nome}
                              </option>
                              {renderOptions(p.id, level + 1)}
                            </React.Fragment>
                          ));
                      };
                      return renderOptions();
                    })()}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-400 mb-1">Secretaria</label>
                <select 
                  className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg outline-none"
                  value={uploadForm.secretaria_origem}
                  onChange={e => setUploadForm({...uploadForm, secretaria_origem: e.target.value})}
                >
                  <option>Saúde</option>
                  <option>Educação</option>
                  <option>Obras</option>
                  <option>Fazenda</option>
                  <option>Assistência Social</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-400 mb-1">Data de Emissão</label>
                <input 
                  type="date" 
                  required
                  className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg outline-none"
                  value={uploadForm.data_emissao}
                  onChange={e => setUploadForm({...uploadForm, data_emissao: e.target.value})}
                />
              </div>
              <div className="border-2 border-dashed border-gray-200 rounded-xl p-4 text-center hover:border-blue-400 transition-colors cursor-pointer relative">
                <input 
                  type="file" 
                  accept="application/pdf"
                  required
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  onChange={e => setUploadForm({...uploadForm, file: e.target.files?.[0] || null})}
                />
                <Upload className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-500">
                  {uploadForm.file ? uploadForm.file.name : "Clique ou arraste o PDF digitalizado"}
                </p>
              </div>
              <button 
                disabled={isUploading}
                className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 transition-all disabled:opacity-50 flex justify-center items-center gap-2"
              >
                {isUploading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Iniciar Processamento OCR"}
              </button>
            </form>

            <AnimatePresence>
              {uploadStatus && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className={`mt-4 p-3 rounded-lg flex items-center gap-2 text-sm ${uploadStatus.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}
                >
                  {uploadStatus.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                  {uploadStatus.message}
                </motion.div>
              )}
            </AnimatePresence>
          </section>

          {/* Filtros de Busca */}
          <section className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Filter className="w-5 h-5 text-gray-600" />
              Filtros de Busca
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-400 mb-1">Secretaria</label>
                <select 
                  className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg outline-none"
                  value={secretaria}
                  onChange={e => setSecretaria(e.target.value)}
                >
                  <option value="">Todas</option>
                  <option>Saúde</option>
                  <option>Educação</option>
                  <option>Obras</option>
                  <option>Fazenda</option>
                  <option>Assistência Social</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-400 mb-1">Tipo de Documento</label>
                <select 
                  className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg outline-none"
                  value={tipo}
                  onChange={e => setTipo(e.target.value)}
                >
                  <option value="">Todos</option>
                  <option>Contrato</option>
                  <option>Decreto</option>
                  <option>Portaria</option>
                  <option>Ofício</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-gray-400 mb-1">Início</label>
                  <input 
                    type="date" 
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg outline-none text-sm"
                    value={dataInicio}
                    onChange={e => setDataInicio(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-gray-400 mb-1">Fim</label>
                  <input 
                    type="date" 
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg outline-none text-sm"
                    value={dataFim}
                    onChange={e => setDataFim(e.target.value)}
                  />
                </div>
              </div>
              <button 
                onClick={() => handleSearch()}
                className="w-full border border-gray-200 text-gray-700 py-2 rounded-lg font-medium hover:bg-gray-50 transition-all"
              >
                Aplicar Filtros
              </button>
            </div>
          </section>
        </aside>

        {/* Main Content: Busca e Resultados */}
        <div className="lg:col-span-8 space-y-6">
          
          {/* Barra de Busca Full-Text */}
          <div className="relative">
            <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input 
              type="text" 
              className="w-full pl-14 pr-6 py-5 bg-white border border-gray-200 rounded-2xl shadow-sm focus:ring-2 focus:ring-blue-500 outline-none text-lg transition-all"
              placeholder="Busque por palavras dentro dos documentos (ex: 'asfalto rua x')..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
            />
          </div>

          {/* Lista de Resultados */}
          <div className="space-y-4">
            <div className="flex justify-between items-center px-2">
              <span className="text-sm text-gray-500 font-medium">
                {isSearching ? "Buscando..." : `${results.length} documentos encontrados`}
              </span>
            </div>

            <AnimatePresence mode="popLayout">
              {results.map((doc) => (
                <motion.div 
                  key={doc.id}
                  layout
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm hover:border-blue-300 transition-all group cursor-pointer"
                >
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <h3 className="text-xl font-bold text-gray-900 group-hover:text-blue-600 transition-colors">
                        {doc.titulo}
                      </h3>
                      <div className="flex gap-4 mt-2">
                        <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full">
                          <Building2 className="w-3 h-3" />
                          {doc.secretaria_origem}
                        </span>
                        <span className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 bg-blue-50 px-2.5 py-1 rounded-full">
                          <FileText className="w-3 h-3" />
                          {doc.tipo_documento}
                        </span>
                        <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-500">
                          <Calendar className="w-3 h-3" />
                          {new Date(doc.data_emissao).toLocaleDateString('pt-BR')}
                        </span>
                      </div>
                    </div>
                    <div className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded border ${
                      doc.status === 'concluido' ? 'border-green-200 text-green-600 bg-green-50' : 
                      doc.status === 'processando' ? 'border-yellow-200 text-yellow-600 bg-yellow-50' : 
                      'border-red-200 text-red-600 bg-red-50'
                    }`}>
                      {doc.status}
                    </div>
                  </div>
                  
                  {doc.snippet && (
                    <div className="mt-4 p-4 bg-gray-50 rounded-xl border border-gray-100 text-sm text-gray-600 leading-relaxed italic">
                      "... <span dangerouslySetInnerHTML={{ __html: doc.snippet }} /> ..."
                    </div>
                  )}

                  <div className="mt-4 flex justify-end gap-4">
                    <button 
                      onClick={() => setSelectedDocForPreview(doc)}
                      className="text-sm font-bold text-blue-600 hover:underline flex items-center gap-1"
                    >
                      Pré-visualizar →
                    </button>
                    <a 
                      href={doc.arquivo_url.startsWith('http') ? doc.arquivo_url : `/${doc.arquivo_url}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-bold text-gray-500 hover:underline flex items-center gap-1"
                    >
                      Abrir Original
                    </a>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {!isSearching && results.length === 0 && (
              <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-gray-200">
                <Search className="w-12 h-12 text-gray-200 mx-auto mb-4" />
                <p className="text-gray-400 font-medium">Nenhum documento encontrado para esta busca.</p>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Modal de Pré-visualização */}
      <AnimatePresence>
        {selectedDocForPreview && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => setSelectedDocForPreview(null)}
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-white w-full max-w-5xl h-[90vh] rounded-3xl overflow-hidden shadow-2xl flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-white">
                <div>
                  <h3 className="text-xl font-bold text-gray-900">{selectedDocForPreview.titulo}</h3>
                  <p className="text-sm text-gray-500">{selectedDocForPreview.tipo_documento} • {selectedDocForPreview.secretaria_origem}</p>
                </div>
                <button 
                  onClick={() => setSelectedDocForPreview(null)}
                  className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                >
                  <X className="w-6 h-6 text-gray-400" />
                </button>
              </div>
              
              <div className="flex-1 bg-gray-100 relative">
                <iframe 
                  src={selectedDocForPreview.arquivo_url.startsWith('http') ? selectedDocForPreview.arquivo_url : `/${selectedDocForPreview.arquivo_url}`}
                  className="w-full h-full border-none"
                  title="PDF Preview"
                />
              </div>

              {selectedDocForPreview.conteudo_ocr && (
                <div className="p-6 bg-gray-50 border-t border-gray-100 max-h-48 overflow-y-auto">
                  <h4 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">Texto Extraído (OCR)</h4>
                  <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
                    {selectedDocForPreview.conteudo_ocr}
                  </p>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <DMSApp />
    </ErrorBoundary>
  );
}
