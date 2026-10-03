import { useCallback, useEffect, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { AppText, Button, Card, Input, MonogramWatermark, Screen, colors, spacing } from "@fairmove/ui";
import { api, type DriverDocumentItem, type DriverDocumentPayload } from "../../src/services/api";

type DocType = DriverDocumentPayload["docType"];

const MAX_DATA_CHARS = 1_500_000;

const DOC_LABELS: Array<{ type: DocType; label: string; hint: string }> = [
  { type: "cnh_front", label: "CNH — FRENTE", hint: "Com número e validade legíveis" },
  { type: "cnh_back", label: "CNH — VERSO", hint: "Verso completo" },
  { type: "vehicle_front", label: "VEÍCULO — FRENTE", hint: "Placa visível" },
  { type: "vehicle_back", label: "VEÍCULO — TRÁS", hint: "Placa visível" },
  { type: "vehicle_side", label: "VEÍCULO — LADO", hint: "Lado do motorista" },
  { type: "crlv", label: "CRLV", hint: "Documento do veículo" },
];

type PickedImage = { mimeType: string; data: string };

type Drafts = Partial<Record<DocType, PickedImage>>;

const STATUS_COPY: Record<string, { title: string; body: string; danger?: boolean }> = {
  pending: {
    title: "Seus documentos estão em análise",
    body: "A aprovação manual leva de 1 a 5 dias. Você será bloqueado para corridas até a análise terminar.",
  },
  approved: {
    title: "Cadastro aprovado",
    body: "Documentação aceita — você pode operar normalmente.",
  },
  rejected: {
    title: "Documentação rejeitada",
    body: "Corrija os problemas indicados e reenvie o conjunto completo.",
    danger: true,
  },
  suspended: {
    title: "Conta suspensa",
    body: "Fale com o suporte. Envio de documentos está bloqueado durante a suspensão.",
    danger: true,
  },
};

/**
 * Cadastro de motorista em 3 estágios:
 * 1. veículo (POST /users/driver/onboard → nasce PENDING);
 * 2. documentos (CNH frente/verso, fotos do veículo, CRLV) → POST /users/driver/documents;
 * 3. status da aprovação manual (pending/approved/rejected/suspended).
 */
export default function DriverDocuments() {
  const router = useRouter();
  const [driverId, setDriverId] = useState<string | null>(null);
  const [approvalStatus, setApprovalStatus] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<DriverDocumentItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [plate, setPlate] = useState("");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [color, setColor] = useState("");
  const [vehicleType, setVehicleType] = useState("car");

  const [drafts, setDrafts] = useState<Drafts>({});
  const [cnhNumber, setCnhNumber] = useState("");
  const [cnhExpiresOn, setCnhExpiresOn] = useState("");
  const [renavam, setRenavam] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const me = await api.getMe();
      if (me.driver) {
        setDriverId(String(me.driver.id ?? ""));
        setApprovalStatus(String(me.driver.approvalStatus ?? "approved"));
        try {
          const docs = await api.getDriverDocuments();
          setSubmitted(docs.documents);
          setApprovalStatus(docs.approvalStatus);
        } catch {
          // sem documentos ainda
        }
      }
    } catch {
      // sessão fora → AuthProvider redireciona
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const locked = approvalStatus === "pending" || approvalStatus === "suspended";
  const readOnly = approvalStatus === "approved" || approvalStatus === "suspended";

  const pickImage = async (docType: DocType) => {
    if (readOnly) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.5,
      base64: true,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset.base64) {
      Alert.alert("Falha ao ler a imagem", "Tente outra foto.");
      return;
    }
    const mimeType = asset.mimeType ?? "image/jpeg";
    const data = `data:${mimeType};base64,${asset.base64}`;
    if (data.length > MAX_DATA_CHARS) {
      Alert.alert("Imagem muito grande", "Escolha uma foto de menor tamanho.");
      return;
    }
    setDrafts((prev) => ({ ...prev, [docType]: { mimeType, data } }));
  };

  const onOnboard = async () => {
    if (busy) return;
    if (!plate.trim() || !brand.trim() || !model.trim() || !/^\d{4}$/.test(year)) {
      setError("Preencha placa (ABC1D23), marca, modelo e ano (4 dígitos).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.driverOnboard({
        plate: plate.trim().toUpperCase(),
        brand: brand.trim(),
        model: model.trim(),
        year: Number(year),
        color: color.trim() || undefined,
        vehicleType,
      });
      setDriverId(result.driverId);
      setApprovalStatus(result.approvalStatus);
    } catch (err) {
      const message = err instanceof Error && err.message.includes("HTTP 409");
      setError(message ? "Placa já cadastrada ou você já tem cadastro de motorista." : "Não foi possível concluir agora.");
    } finally {
      setBusy(false);
    }
  };

  const onSubmitDocs = async () => {
    if (busy) return;
    if (!/^\d{11}$/.test(cnhNumber)) {
      setError("CNH deve ter 11 dígitos.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cnhExpiresOn)) {
      setError("Validade da CNH no formato AAAA-MM-DD.");
      return;
    }
    if (new Date(cnhExpiresOn).getTime() <= Date.now()) {
      setError("CNH vencida — renove antes de enviar.");
      return;
    }
    if (!/^\d{11}$/.test(renavam)) {
      setError("Renavam deve ter 11 dígitos.");
      return;
    }
    const missing = DOC_LABELS.filter((d) => !drafts[d.type]);
    if (missing.length > 0) {
      setError(`Faltam imagens: ${missing.map((m) => m.label).join(", ")}`);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const documents: DriverDocumentPayload[] = DOC_LABELS.map((d) => {
        const img = drafts[d.type]!;
        const base: DriverDocumentPayload = {
          docType: d.type,
          mimeType: img.mimeType as DriverDocumentPayload["mimeType"],
          data: img.data,
        };
        if (d.type === "cnh_front") {
          base.cnhNumber = cnhNumber;
          base.cnhExpiresOn = cnhExpiresOn;
        }
        if (d.type === "crlv") base.renavam = renavam;
        return base;
      });
      const result = await api.submitDriverDocuments(documents);
      setApprovalStatus(result.approvalStatus);
      setDrafts({});
      await refresh();
      Alert.alert("Documentos enviados", "Sua candidatura está em análise.");
    } catch (err) {
      const body = err instanceof Error ? err.message : "";
      setError(body.includes("HTTP 422") ? "Conjunto incompleto ou dados inválidos." : "Falha no envio. Tente novamente.");
    } finally {
      setBusy(false);
    }
  };

  const status = approvalStatus ? STATUS_COPY[approvalStatus] : null;

  return (
    <Screen>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.container}>
          <MonogramWatermark />
          <AppText variant="title">Cadastro de motorista</AppText>

          {loaded && status ? (
            <Card variant={status.danger ? "solid" : "glass"}>
              <AppText variant="caption" color={status.danger ? colors.danger : colors.gold.DEFAULT}>
                {approvalStatus?.toUpperCase()}
              </AppText>
              <AppText variant="bodyStrong">{status.title}</AppText>
              <AppText variant="caption">{status.body}</AppText>
              {submitted.length > 0 ? (
                <AppText variant="caption" color={colors.ice.muted}>
                  {submitted.length} documento(s) enviados — consulta em "Documentos enviados".
                </AppText>
              ) : null}
            </Card>
          ) : null}

          {!driverId ? (
            <Card>
              <AppText variant="subtitle">1. Seu veículo</AppText>
              <Input label="Placa" placeholder="ABC1D23" autoCapitalize="characters" value={plate} onChangeText={setPlate} />
              <Input label="Marca" placeholder="Toyota" value={brand} onChangeText={setBrand} />
              <Input label="Modelo" placeholder="Corolla" value={model} onChangeText={setModel} />
              <Input label="Ano" placeholder="2022" keyboardType="number-pad" maxLength={4} value={year} onChangeText={setYear} />
              <Input label="Cor (opcional)" placeholder="Prata" value={color} onChangeText={setColor} />
              <Button
                title={vehicleType === "car" ? "TIPO: CARRO" : "TIPO: MOTO"}
                variant="ghost"
                onPress={() => setVehicleType((t) => (t === "car" ? "motorcycle" : "car"))}
              />
              <Button title="CADASTRAR VEÍCULO" onPress={() => void onOnboard()} disabled={busy} />
            </Card>
          ) : (
            <Card>
              <AppText variant="subtitle">2. Documentos obrigatórios</AppText>
              <AppText variant="caption">
                CNH (frente e verso), fotos do veículo (frente, trás, lado) e CRLV com Renavam.
              </AppText>

              <Input
                label="Número da CNH (11 dígitos)"
                keyboardType="number-pad"
                maxLength={11}
                value={cnhNumber}
                onChangeText={setCnhNumber}
                editable={!readOnly}
              />
              <Input
                label="Validade da CNH (AAAA-MM-DD)"
                placeholder="2030-05-20"
                value={cnhExpiresOn}
                onChangeText={setCnhExpiresOn}
                editable={!readOnly}
              />
              <Input
                label="Renavam do veículo (11 dígitos)"
                keyboardType="number-pad"
                maxLength={11}
                value={renavam}
                onChangeText={setRenavam}
                editable={!readOnly}
              />

              {DOC_LABELS.map((doc) => {
                const picked = drafts[doc.type];
                const already = submitted.find((d) => d.docType === doc.type);
                return (
                  <Card key={doc.type} variant="glass">
                    <AppText variant="caption" color={colors.gold.DEFAULT}>
                      {doc.label}
                    </AppText>
                    <AppText variant="caption">{doc.hint}</AppText>
                    <AppText variant="caption" color={picked ? colors.success : colors.ice.muted}>
                      {picked
                        ? "✓ selecionada"
                        : already
                          ? "✓ já enviada"
                          : "não enviada"}
                    </AppText>
                    {!readOnly ? (
                      <Button
                        title={picked || already ? "TROCAR IMAGEM" : "ESCOLHER IMAGEM"}
                        variant="ghost"
                        onPress={() => void pickImage(doc.type)}
                      />
                    ) : null}
                  </Card>
                );
              })}

              {error ? <AppText variant="caption" color={colors.danger}>{error}</AppText> : null}

              {!readOnly ? (
                <Button
                  title={locked ? "AGUARDANDO ANÁLISE" : "ENVIAR DOCUMENTOS"}
                  onPress={() => void onSubmitDocs()}
                  disabled={busy || locked}
                />
              ) : null}
              {locked ? (
                <AppText variant="caption" color={colors.ice.muted}>
                  Enviado — alterações liberadas após a análise.
                </AppText>
              ) : null}
            </Card>
          )}

          <Button title="VOLTAR" variant="secondary" onPress={() => router.back()} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { gap: spacing.lg, padding: spacing.xl, paddingBottom: spacing.xxxl },
});
