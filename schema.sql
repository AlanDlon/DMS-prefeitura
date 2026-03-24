-- ===============================================================
-- DMS PREFEITURA - SCHEMA POSTGRESQL
-- ===============================================================

-- Extensão para busca semântica/full-text se necessário, 
-- embora o PostgreSQL já suporte FTS nativamente.
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Tabela principal de documentos
CREATE TABLE IF NOT EXISTS documentos (
    id_unico UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    titulo TEXT NOT NULL,
    data_emissao DATE,
    data_upload TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    tipo_documento TEXT NOT NULL, -- Ex: Contrato, Decreto, Portaria
    secretaria_origem TEXT NOT NULL, -- Ex: Saúde, Educação, Obras
    status TEXT DEFAULT 'processando', -- processando, concluido, erro
    arquivo_url TEXT NOT NULL, -- Caminho no storage/S3
    conteudo_ocr TEXT, -- Texto completo extraído pelo OCR
    
    -- Coluna para busca Full-Text (FTS)
    -- tsvector armazena o texto processado para buscas rápidas
    fts_documento tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('portuguese', coalesce(titulo, '')), 'A') ||
        setweight(to_tsvector('portuguese', coalesce(tipo_documento, '')), 'B') ||
        setweight(to_tsvector('portuguese', coalesce(secretaria_origem, '')), 'B') ||
        setweight(to_tsvector('portuguese', coalesce(conteudo_ocr, '')), 'C')
    ) STORED
);

-- Índices para performance
CREATE INDEX idx_documentos_data_emissao ON documentos(data_emissao);
CREATE INDEX idx_documentos_secretaria ON documentos(secretaria_origem);
CREATE INDEX idx_documentos_tipo ON documentos(tipo_documento);

-- Índice GIN para busca Full-Text
-- O GIN (Generalized Inverted Index) é ideal para FTS no PostgreSQL
CREATE INDEX idx_documentos_fts ON documentos USING GIN(fts_documento);

-- Comentários da Tabela
COMMENT ON TABLE documentos IS 'Tabela central para armazenamento de metadados e conteúdo OCR de documentos da prefeitura.';
COMMENT ON COLUMN documentos.conteudo_ocr IS 'Conteúdo textual extraído via OCR para indexação e busca.';
COMMENT ON COLUMN documentos.fts_documento IS 'Vetor pré-processado para busca Full-Text em português.';
