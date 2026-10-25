export function registerOperationRoutes(app, operation) {
  const route = handler => async (req,res,next) => {
    try { await handler(req,res); }
    catch(error) {
      if ([400,404].includes(error.status)) return res.status(error.status).json({error:error.message});
      next(error);
    }
  };
  const requireOffer = async (req,res) => {
    const offer = await operation.get(req.params.id);
    if (!offer) res.status(404).json({error:'Oferta não encontrada.'});
    return offer;
  };
  app.get('/api/my-offers',route(async(req,res)=>res.json({offers:await operation.list()})));
  app.post('/api/my-offers',route(async(req,res)=>res.status(201).json(await operation.create(req.body))));
  app.get('/api/my-offers/:id',route(async(req,res)=>{
    const offer = await requireOffer(req,res);
    if (offer) res.json({...offer,materials:await operation.materials(offer.id)});
  }));
  app.patch('/api/my-offers/:id',route(async(req,res)=>{
    if (!await requireOffer(req,res)) return;
    const offer = await operation.update(req.params.id,req.body);
    if (!offer) return res.status(404).json({error:'Oferta não encontrada.'});
    res.json(offer);
  }));
  app.delete('/api/my-offers/:id',route(async(req,res)=>{
    if (!await operation.remove(req.params.id)) return res.status(404).json({error:'Oferta não encontrada.'});
    res.status(204).end();
  }));
  app.post('/api/my-offers/:id/materials',route(async(req,res)=>{
    res.status(201).json(await operation.createMaterial(req.params.id,req.body));
  }));
  app.patch('/api/my-offers/:id/materials/:materialId',route(async(req,res)=>{
    const material = await operation.updateMaterial(req.params.id,req.params.materialId,req.body);
    if (!material) return res.status(404).json({error:'Material não encontrado nesta oferta.'});
    res.json(material);
  }));
  app.delete('/api/my-offers/:id/materials/:materialId',route(async(req,res)=>{
    if (!await operation.removeMaterial(req.params.id,req.params.materialId)) return res.status(404).json({error:'Material não encontrado nesta oferta.'});
    res.status(204).end();
  }));
}
